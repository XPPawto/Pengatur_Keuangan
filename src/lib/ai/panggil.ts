import type { Db } from "../db";
import { fmtTanggal, fromWib, HARI, wibDate, wibHM, wibWeekday } from "../time";
import { enqueue } from "../services/outbox";
import { recipientsFor } from "../services/recipients";
import { getSetting, getSettingNumber } from "../services/settings";
import { adaLoginFolder, JENDELA, penjalanCli, type AlasanGagal, type HasilClaude, type InfoBatas, type JendelaBatas, type NamaJendela, type Penjalan } from "./claude";
import { dekripsi, enkripsi, samarkan } from "./rahasia";
import { adaLoginGemini, daftarModelGeminiCache, penjalanGeminiOtomatis, segarkanDaftarGemini, type PenjalanGemini } from "./gemini";
import { daftarModelGroqCache, modelGroqValid, penjalanGroq, segarkanDaftarGroq, type PenjalanGroq } from "./groq";
import { daftarModelGratis, modelGratis, penjalanOpenRouter, type PenjalanOpenRouter } from "./openrouter";
import { bacaStatistik, calonGemini, calonGroq, catatModel, jenisGagal, sedangDitahan, urutkanModel } from "./modelOtomatis";

export type Penyedia = "claude" | "gemini" | "openrouter" | "groq";
export const CADANGAN = ["gemini", "openrouter", "groq"] as const;
export type PenyediaCadangan = (typeof CADANGAN)[number];
export const LABEL_PENYEDIA: Record<Penyedia, string> = { claude: "Claude", gemini: "Gemini", openrouter: "OpenRouter", groq: "Groq" };
/** Hasil panggilan beserta penyedia yang akhirnya menjawab. */
export type HasilAI = HasilClaude & { penyedia?: Penyedia; /** model yang benar-benar dipakai */ model?: string };

export type FiturAI = "chat_web" | "chat_wa" | "chat_grup" | "struk" | "kategori" | "review" | "cek";

export const LABEL_FITUR: Record<FiturAI, string> = {
  chat_web: "Chat website",
  chat_wa: "Asisten WhatsApp",
  chat_grup: "AI grup WhatsApp",
  struk: "Baca foto",
  kategori: "Tebak kategori",
  review: "Review Sabtu",
  cek: "Cek koneksi",
};

export type KondisiAI = "ok" | "belum_dicek" | Exclude<AlasanGagal, "kuota" | "dimatikan">;

export interface StatusTersimpan {
  status: KondisiAI;
  pesan: string;
  /** sejak kapan status ini berlaku */
  sejak: string;
  terakhirCoba: string | null;
  terakhirOk: string | null;
  /** kena batas langganan: jangan panggil Claude sebelum waktu reset ini */
  tahanSampai?: string | null;
}

// ---------------------------------------------------------------- batas langganan (sesi 5 jam & mingguan)

export const LABEL_JENDELA: Record<NamaJendela, string> = {
  five_hour: "Sesi 5 jam",
  seven_day: "Mingguan (semua model)",
  seven_day_opus: "Mingguan (Opus)",
  seven_day_sonnet: "Mingguan (Sonnet)",
};

interface BatasTersimpan {
  jendela: Partial<Record<NamaJendela, JendelaBatas & { diperbarui: string }>>;
  status?: string;
}

/** Jam reset dalam WIB yang enak dibaca: "15.20", "besok 07.00", "Sen 07.00", "3 Okt 07.00". */
export function jamReset(detikEpoch: number, now: Date): string {
  const d = new Date(detikEpoch * 1000);
  const { jam, menit } = wibHM(d);
  const hm = `${String(jam).padStart(2, "0")}.${String(menit).padStart(2, "0")}`;
  const selisihHari = Math.round((fromWib(wibDate(d)).getTime() - fromWib(wibDate(now)).getTime()) / 86400_000);
  if (selisihHari <= 0) return hm;
  if (selisihHari === 1) return `besok ${hm}`;
  if (selisihHari < 7) return `${HARI[wibWeekday(d)].slice(0, 3)} ${hm}`;
  return `${fmtTanggal(wibDate(d))} ${hm}`;
}

async function simpanBatas(db: Db, b: InfoBatas, now: Date) {
  const lama = await bacaBatasMentah(db);
  const iso = now.toISOString();
  for (const k of JENDELA) {
    const j = b.jendela[k];
    if (j) lama.jendela[k] = { ...j, diperbarui: iso };
  }
  if (b.status) lama.status = b.status;
  const nilai = JSON.stringify(lama);
  await db.setting.upsert({ where: { kunci: "ai_batas_claude" }, update: { nilai }, create: { kunci: "ai_batas_claude", nilai } });
}

async function bacaBatasMentah(db: Db): Promise<BatasTersimpan> {
  const row = await db.setting.findUnique({ where: { kunci: "ai_batas_claude" } });
  try {
    return row ? (JSON.parse(row.nilai) as BatasTersimpan) : { jendela: {} };
  } catch {
    return { jendela: {} };
  }
}

/**
 * Pemakaian langganan Claude per jendela (dari respons terakhir yang dilihat bot). Jendela yang waktu
 * resetnya sudah lewat ditampilkan 0% (sudah reset) sampai bot melihat angka baru.
 */
export async function batasClaude(db: Db, now: Date) {
  const b = await bacaBatasMentah(db);
  return JENDELA.filter((k) => b.jendela[k]).map((k) => {
    const j = b.jendela[k]!;
    const lewat = j.resetsAt !== null && j.resetsAt * 1000 <= now.getTime();
    return {
      kode: k,
      label: LABEL_JENDELA[k],
      persen: lewat ? 0 : j.persen,
      reset: j.resetsAt && !lewat ? jamReset(j.resetsAt, now) : null,
      sudahReset: lewat,
      diperbarui: j.diperbarui,
    };
  });
}

/** Status yang "menetap" (perlu tindakan pemilik / menunggu reset) — panggilan berikutnya ditahan sebentar. */
const TAHAN_MS: Partial<Record<KondisiAI, number>> = {
  belum_login: 10 * 60_000,
  limit: 20 * 60_000,
  tidak_ada: 10 * 60_000,
  belum_diatur: 0,
};

/** Status yang dikabari ke WhatsApp pemilik (sekali sampai pulih). */
const DIKABARI: KondisiAI[] = ["belum_login", "limit", "tidak_ada"];

let penjalan: Penjalan = penjalanCli;
/** Ganti penjalan (dipakai tes). Mengembalikan fungsi untuk memulihkan. */
export function setPenjalanAI(p: Penjalan): () => void {
  const lama = penjalan;
  penjalan = p;
  return () => {
    penjalan = lama;
  };
}

// Batasi proses `claude` yang jalan bersamaan (tiap proses lumayan makan memori).
const MAKS_PARALEL = 2;
let jalan = 0;
const antre: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (jalan >= MAKS_PARALEL) await new Promise<void>((r) => antre.push(r));
  jalan++;
  try {
    return await fn();
  } finally {
    jalan--;
    antre.shift()?.();
  }
}

// ---------------------------------------------------------------- token

export async function getTokenAI(db: Db): Promise<{ token: string | null; sumber: "website" | "env" | "folder" | null; rusak: boolean }> {
  const row = await db.setting.findUnique({ where: { kunci: "ai_token" } });
  if (row?.nilai) {
    const t = dekripsi(row.nilai);
    if (t) return { token: t, sumber: "website", rusak: false };
    return { token: null, sumber: null, rusak: true };
  }
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return { token: process.env.CLAUDE_CODE_OAUTH_TOKEN, sumber: "env", rusak: false };
  if (adaLoginFolder()) return { token: null, sumber: "folder", rusak: false };
  return { token: null, sumber: null, rusak: false };
}

export async function simpanTokenAI(db: Db, token: string | null) {
  const t = token?.trim();
  if (!t) {
    await db.setting.deleteMany({ where: { kunci: "ai_token" } });
  } else {
    if (t.length < 20 || /\s/.test(t)) throw new Error("Token tidak valid. Salin utuh hasil `claude setup-token`.");
    const nilai = enkripsi(t);
    await db.setting.upsert({ where: { kunci: "ai_token" }, update: { nilai }, create: { kunci: "ai_token", nilai } });
  }
  // token baru = kesempatan baru: buang penahanan status gagal
  await simpanStatus(db, { status: "belum_dicek", pesan: "", sejak: new Date().toISOString(), terakhirCoba: null, terakhirOk: (await bacaStatus(db)).terakhirOk });
}

// ---------------------------------------------------------------- status

export async function bacaStatus(db: Db): Promise<StatusTersimpan> {
  const row = await db.setting.findUnique({ where: { kunci: "ai_status" } });
  if (row) {
    try {
      return JSON.parse(row.nilai) as StatusTersimpan;
    } catch {
      /* rusak → anggap belum dicek */
    }
  }
  return { status: "belum_dicek", pesan: "", sejak: new Date(0).toISOString(), terakhirCoba: null, terakhirOk: null };
}

async function simpanStatus(db: Db, s: StatusTersimpan) {
  const nilai = JSON.stringify(s);
  await db.setting.upsert({ where: { kunci: "ai_status" }, update: { nilai }, create: { kunci: "ai_status", nilai } });
}

export const LABEL_KONDISI: Record<KondisiAI | "dimatikan" | "kuota", string> = {
  ok: "Aktif",
  belum_dicek: "Belum dicek",
  belum_diatur: "Token belum diatur",
  belum_login: "Token ditolak / logout",
  limit: "Kena batas pemakaian Claude",
  sibuk: "Server Claude sibuk",
  timeout: "Claude lambat merespons",
  tidak_ada: "Claude Code belum terpasang",
  gagal: "Error",
  dimatikan: "Dimatikan",
  kuota: "Batas harian tercapai",
};

/** Ringkasan lengkap untuk halaman Asisten, Sistem, dan bot. */
export async function statusAI(db: Db, now: Date) {
  const [aktif, batas, tersimpan, tok, pakai, langganan, claudeAktif, cadangan] = await Promise.all([
    getSetting(db, "ai_aktif"),
    getSettingNumber(db, "ai_batas_harian"),
    bacaStatus(db),
    getTokenAI(db),
    pemakaianHariIni(db, now),
    batasClaude(db, now),
    getSetting(db, "ai_claude_aktif"),
    statusCadangan(db),
  ]);
  const adaAkses = !!tok.token || tok.sumber === "folder";
  const kondisi: KondisiAI | "dimatikan" | "kuota" =
    aktif !== "1" || claudeAktif !== "1" ? "dimatikan" : !adaAkses ? "belum_diatur" : pakai >= batas ? "kuota" : tersimpan.status;
  const claudeSiap = kondisi === "ok" || kondisi === "belum_dicek" || kondisi === "sibuk" || kondisi === "timeout" || kondisi === "gagal";
  const cadanganSiap = aktif === "1" && pakai < batas && cadangan.some((c) => c.siap);
  return {
    aktif: aktif === "1",
    kondisi,
    label: claudeAktif !== "1" && aktif === "1" ? "Claude dimatikan" : LABEL_KONDISI[kondisi],
    pesan: tok.rusak ? "Token tersimpan tidak bisa dibuka (SESSION_SECRET berubah?). Simpan ulang tokennya." : tersimpan.pesan,
    /** ada penyedia (Claude atau cadangan) yang bisa dipakai sekarang */
    siap: claudeSiap || cadanganSiap,
    claudeSiap,
    cadangan,
    token: { ada: adaAkses, sumber: tok.sumber, samaran: tok.token ? samarkan(tok.token) : null, rusak: tok.rusak },
    pemakaian: { hariIni: pakai, batas },
    langganan,
    tahanSampai: tersimpan.tahanSampai && new Date(tersimpan.tahanSampai) > now ? jamReset(new Date(tersimpan.tahanSampai).getTime() / 1000, now) : null,
    sejak: tersimpan.sejak,
    terakhirOk: tersimpan.terakhirOk,
    terakhirCoba: tersimpan.terakhirCoba,
  };
}

/** Panggilan yang benar-benar dicoba hari ini (WIB). */
export async function pemakaianHariIni(db: Db, now: Date): Promise<number> {
  // satu permintaan = satu, walau dicoba ke beberapa penyedia
  // AI grup punya batas harian sendiri (grup_ai_batas_harian) supaya ramainya grup tidak menghabiskan jatah pemilik
  return db.aiCall.count({ where: { waktu: { gte: fromWib(wibDate(now)) }, fitur: { notIn: ["cek", "chat_grup"] }, utama: true } });
}

// ---------------------------------------------------------------- panggil

export interface PermintaanAI {
  fitur: FiturAI;
  system: string;
  prompt: string;
  /** pakai model ringan (hemat kuota) */
  ringan?: boolean;
  gambar?: string;
  timeoutMs?: number;
  now: Date;
  /** abaikan penahanan setelah gagal (tombol "Tes koneksi") */
  paksa?: boolean;
  /** hanya pakai penyedia ini, tanpa pindah ke cadangan (tes koneksi, atau pilihan eksplisit: `or`/`gm` di WhatsApp, pilihan di website) */
  penyedia?: Penyedia;
  /** pakai model ini, bukan model dari pengaturan. Hanya bersama `penyedia`; divalidasi oleh `modelValid` */
  model?: string;
}

/** Nama model yang boleh dipilih langsung. Claude: alias Claude Code (sonnet, opus, …) atau nama lengkap. OpenRouter: wajib gratis (:free). */
export function modelValid(p: Penyedia, m: string): boolean {
  if (p === "gemini") return /^gemini-[\w.-]{1,60}$/.test(m);
  if (p === "openrouter") return modelGratis(m);
  if (p === "groq") return modelGroqValid(m);
  return /^[\w.\-[\]]{1,60}$/.test(m);
}

const gagal = (alasan: AlasanGagal, pesan: string): HasilClaude => ({ ok: false, alasan, pesan, durasiMs: 0 });

/** Urutan penyedia yang dicoba: Claude (kalau aktif) lalu cadangan aktif sesuai urutan di pengaturan. */
export async function urutanPenyedia(db: Db): Promise<Penyedia[]> {
  const [claude, urutan, ...aktif] = await Promise.all([
    getSetting(db, "ai_claude_aktif"),
    getSetting(db, "ai_urutan_cadangan"),
    ...CADANGAN.map((p) => getSetting(db, `ai_${p}_aktif`)),
  ]);
  const nyala = new Set(CADANGAN.filter((_, i) => aktif[i] === "1"));
  const cadangan = [...new Set([...urutan.split(","), ...CADANGAN])].filter((p): p is PenyediaCadangan => nyala.has(p as PenyediaCadangan));
  return [...(claude === "1" ? (["claude"] as Penyedia[]) : []), ...cadangan];
}

/**
 * Satu-satunya pintu ke AI. Menjaga saklar & kuota harian, lalu mencoba Claude; kalau Claude tidak bisa
 * dipakai (belum diatur, token ditolak, kena batas, sibuk, error), otomatis pindah ke cadangan (Gemini,
 * OpenRouter gratis) sesuai urutan. Tidak pernah melempar error.
 */
export async function panggilAI(db: Db, r: PermintaanAI): Promise<HasilAI> {
  if ((await getSetting(db, "ai_aktif")) !== "1") return gagal("dimatikan", "Asisten AI dimatikan di Pengaturan.");
  if (r.fitur !== "cek" && r.fitur !== "chat_grup") {
    const batas = await getSettingNumber(db, "ai_batas_harian");
    if ((await pemakaianHariIni(db, r.now)) >= batas) return gagal("kuota", `Batas ${batas} pemakaian AI hari ini udah habis.`);
  }
  if (r.model !== undefined) {
    if (!r.penyedia) return gagal("gagal", "Model hanya bisa dipilih bersama penyedianya.");
    if (!modelValid(r.penyedia, r.model)) {
      return gagal("gagal", r.penyedia === "openrouter" ? `Model "${r.model.slice(0, 80)}" bukan model gratis OpenRouter (harus berakhiran :free).` : `Nama model "${r.model.slice(0, 80)}" tidak valid untuk ${LABEL_PENYEDIA[r.penyedia]}.`);
    }
  }
  const urutan = r.penyedia ? [r.penyedia] : await urutanPenyedia(db);
  if (!urutan.length) return gagal("belum_diatur", "Belum ada penyedia AI yang aktif.");
  const adaCadangan = urutan.filter((p) => p !== "claude").map((p) => LABEL_PENYEDIA[p]);

  let pertama: HasilAI | null = null;
  let tercatat = false;
  for (const p of urutan) {
    if (r.gambar && p === "groq" && !r.penyedia) continue; // Groq tidak dipakai untuk gambar: lewati ke penyedia berikutnya
    const c: HasilCoba = p === "claude" ? await cobaClaude(db, r, !tercatat, adaCadangan) : await cobaCadangan(db, p, r, !tercatat);
    tercatat ||= c.tercatat;
    if (c.hasil.ok) return { ...c.hasil, penyedia: p, model: c.model };
    pertama ??= { ...c.hasil, penyedia: p, model: c.model };
  }
  return pertama!;
}

/** Hasil satu penyedia: `model` terisi kalau penyedia benar-benar dipanggil. */
type HasilCoba = { hasil: HasilClaude; tercatat: boolean; model?: string };

async function cobaClaude(db: Db, r: PermintaanAI, utama: boolean, cadangan: string[]): Promise<HasilCoba> {
  const tidak = (alasan: AlasanGagal, pesan: string) => ({ hasil: gagal(alasan, pesan), tercatat: false });
  const tok = await getTokenAI(db);
  if (!tok.token && tok.sumber !== "folder") {
    return tidak("belum_diatur", tok.rusak ? "Token tersimpan tidak bisa dibuka. Simpan ulang di halaman Koneksi." : "Token Claude belum diatur.");
  }

  const st = await bacaStatus(db);
  if (!r.paksa && st.status === "limit" && st.tahanSampai && r.now < new Date(st.tahanSampai)) {
    return tidak("limit", `Kena batas langganan Claude, reset ${jamReset(new Date(st.tahanSampai).getTime() / 1000, r.now)}.`);
  }
  const tahan = TAHAN_MS[st.status];
  if (!r.paksa && !(st.status === "limit" && st.tahanSampai) && tahan && st.terakhirCoba && r.now.getTime() - new Date(st.terakhirCoba).getTime() < tahan) {
    return tidak(st.status as AlasanGagal, st.pesan);
  }

  // Hemat otomatis: kalau sesi 5 jam / mingguan langganan hampir habis, tugas kecil tidak memakai Claude
  // supaya sisanya tetap ada buat pemilik (di bot maupun claude.ai).
  if (r.fitur === "kategori" || r.fitur === "review") {
    const hampir = (await batasClaude(db, r.now)).find((j) => (j.kode === "five_hour" && j.persen >= 90) || (j.kode !== "five_hour" && j.persen >= 95));
    if (hampir) return tidak("limit", `${hampir.label} sudah ${Math.round(hampir.persen)}%, tugas kecil dihemat.`);
  }

  const model = r.model ?? (await getSetting(db, r.ringan ? "ai_model_ringan" : "ai_model"));
  // baris "berjalan" dulu supaya peta koneksi bisa menampilkan Claude yang sedang mikir secara langsung
  const log = await db.aiCall.create({ data: { waktu: r.now, fitur: r.fitur, penyedia: "claude", utama, model, status: "berjalan" } });
  let hasil: HasilClaude;
  try {
    hasil = await slot(() => penjalan({ system: r.system, prompt: r.prompt, model, gambar: r.gambar, timeoutMs: r.timeoutMs, token: tok.token }));
  } catch (e) {
    hasil = { ok: false, alasan: "gagal", pesan: e instanceof Error ? e.message : String(e), durasiMs: 0 };
  }

  await db.aiCall.update({
    where: { id: log.id },
    data: {
      status: hasil.ok ? "ok" : hasil.alasan,
      durasiMs: hasil.durasiMs,
      tokenMasuk: hasil.token?.masuk ?? 0,
      tokenKeluar: hasil.token?.keluar ?? 0,
      catatan: hasil.ok ? null : hasil.pesan.slice(0, 300),
    },
  });
  if (hasil.batas) await simpanBatas(db, hasil.batas, r.now);
  // model pilihan yang gagal (mis. nama model salah) tidak boleh menandai Claude sebagai "mati" / mengirim kabar ke pemilik
  if (!(r.model && !hasil.ok)) await catatKondisi(db, st, hasil, r.now, cadangan);
  return { hasil, tercatat: true, model };
}

async function catatKondisi(db: Db, lama: StatusTersimpan, h: HasilClaude, now: Date, cadangan: string[] = []) {
  const baru: KondisiAI = h.ok ? "ok" : (h.alasan as KondisiAI);
  const iso = now.toISOString();
  const reset = !h.ok && baru === "limit" ? (h.batas?.resetsAt ?? null) : null;
  const tahanSampai = reset && reset * 1000 > now.getTime() ? new Date(reset * 1000).toISOString() : null;
  await simpanStatus(db, {
    status: baru,
    pesan: h.ok ? "" : h.pesan,
    sejak: baru === lama.status ? lama.sejak : iso,
    terakhirCoba: iso,
    terakhirOk: h.ok ? iso : lama.terakhirOk,
    tahanSampai,
  });

  const pemilik = await recipientsFor(db, "pemilik");
  if (!h.ok && DIKABARI.includes(baru) && baru !== lama.status) {
    let isi: string = baru === "limit" && tahanSampai ? KABAR.limit.replace("setelah batasnya reset", `setelah batasnya reset (${jamReset(reset!, now)})`) : KABAR[baru as keyof typeof KABAR];
    if (cadangan.length) isi += `\nSementara itu asisten tetap jalan lewat cadangan: ${cadangan.join(", ")}.`;
    for (const nomor of pemilik) await enqueue(db, { nomor, jenis: "ai_status", isi, kunci: `ai:${baru}:${wibDate(now)}:${nomor}` }, now);
  }
  if (h.ok && DIKABARI.includes(lama.status)) {
    const isi = "*Asisten AI aktif lagi.* Fitur `tanya`, baca struk, dan review mingguan udah jalan normal.";
    for (const nomor of pemilik) await enqueue(db, { nomor, jenis: "ai_status", isi, kunci: `ai:pulih:${iso}:${nomor}` }, now);
  }
}

const KABAR = {
  belum_login:
    "*Asisten AI lagi mati*: token Claude ditolak (kedaluwarsa, dicabut, atau langganan berhenti).\nBot tetap jalan normal, cuma fitur AI yang istirahat.\nPerbaiki: jalankan `claude setup-token` di laptop/server, lalu tempel token barunya di website → Asisten → Pengaturan AI.",
  limit:
    "*Asisten AI istirahat*: kena batas pemakaian langganan Claude.\nBot tetap jalan normal. AI nyala lagi otomatis setelah batasnya reset.",
  tidak_ada:
    "*Asisten AI mati*: perintah `claude` tidak ditemukan di server.\nPasang Claude Code di server (lihat README bagian Asisten AI), lalu restart bot.",
} as const;

// ---------------------------------------------------------------- cek koneksi

/** Uji koneksi (tombol di website). Melewati penahanan setelah gagal. */
export async function tesKoneksiAI(db: Db, now: Date, penyedia: Penyedia = "claude"): Promise<HasilAI> {
  return panggilAI(db, { fitur: "cek", system: "Balas persis satu kata: siap", prompt: "tes", ringan: true, now, paksa: true, timeoutMs: 60_000, penyedia });
}

/**
 * Dijalankan bot tiap 30 menit: kalau AI sedang mati karena token/limit/CLI, coba lagi pelan-pelan supaya
 * begitu pemilik memperbaiki token (atau limit reset), AI nyala sendiri dan pemilik dikabari.
 */
export async function cekPulihAI(db: Db, now: Date): Promise<boolean> {
  if ((await getSetting(db, "ai_aktif")) !== "1") return false;
  const st = await bacaStatus(db);
  if (!DIKABARI.includes(st.status)) return false;
  if (st.tahanSampai && now < new Date(st.tahanSampai)) return false;
  const tahan = st.tahanSampai ? 0 : (TAHAN_MS[st.status] ?? 0);
  if (st.terakhirCoba && now.getTime() - new Date(st.terakhirCoba).getTime() < tahan) return false;
  const h = await panggilAI(db, { fitur: "cek", system: "Balas persis satu kata: siap", prompt: "tes", ringan: true, now, timeoutMs: 60_000, penyedia: "claude" });
  return h.ok;
}

// ---------------------------------------------------------------- penyedia cadangan (Gemini, OpenRouter)

let penjalanGemini: PenjalanGemini = penjalanGeminiOtomatis;
let penjalanOR: PenjalanOpenRouter = penjalanOpenRouter;
let penjalanGroqFn: PenjalanGroq = penjalanGroq;
/** Ganti penjalan cadangan (dipakai tes). */
export function setPenjalanCadangan(p: { gemini?: PenjalanGemini; openrouter?: PenjalanOpenRouter; groq?: PenjalanGroq }): () => void {
  const lama = { g: penjalanGemini, o: penjalanOR, q: penjalanGroqFn };
  if (p.gemini) penjalanGemini = p.gemini;
  if (p.openrouter) penjalanOR = p.openrouter;
  if (p.groq) penjalanGroqFn = p.groq;
  return () => {
    penjalanGemini = lama.g;
    penjalanOR = lama.o;
    penjalanGroqFn = lama.q;
  };
}

const ENV_KUNCI: Record<PenyediaCadangan, string> = { gemini: "GEMINI_API_KEY", openrouter: "OPENROUTER_API_KEY", groq: "GROQ_API_KEY" };

/** API key cadangan: dari website (terenkripsi) atau .env; Gemini juga bisa lewat login Google di folder bot. */
export async function kunciCadangan(db: Db, p: PenyediaCadangan): Promise<{ kunci: string | null; sumber: "website" | "env" | "login" | null; rusak: boolean }> {
  const row = await db.setting.findUnique({ where: { kunci: `ai_${p}_key` } });
  if (row?.nilai) {
    const k = dekripsi(row.nilai);
    return k ? { kunci: k, sumber: "website", rusak: false } : { kunci: null, sumber: null, rusak: true };
  }
  const env = process.env[ENV_KUNCI[p]];
  if (env) return { kunci: env, sumber: "env", rusak: false };
  if (p === "gemini" && adaLoginGemini()) return { kunci: null, sumber: "login", rusak: false };
  return { kunci: null, sumber: null, rusak: false };
}

export async function simpanKunciCadangan(db: Db, p: PenyediaCadangan, kunci: string | null) {
  const k = kunci?.trim();
  if (!k) await db.setting.deleteMany({ where: { kunci: `ai_${p}_key` } });
  else {
    if (k.length < 20 || /\s/.test(k)) throw new Error("API key tidak valid. Salin utuh dari halaman penyedianya.");
    const nilai = enkripsi(k);
    await db.setting.upsert({ where: { kunci: `ai_${p}_key` }, update: { nilai }, create: { kunci: `ai_${p}_key`, nilai } });
  }
  await db.setting.deleteMany({ where: { kunci: `ai_status_${p}` } });
}

interface StatusCadangan {
  status: KondisiAI;
  pesan: string;
  terakhirCoba: string | null;
  terakhirOk: string | null;
  /** model yang terakhir dipakai (berguna di mode otomatis OpenRouter) */
  model?: string | null;
}

async function bacaStatusCadangan(db: Db, p: PenyediaCadangan): Promise<StatusCadangan> {
  const row = await db.setting.findUnique({ where: { kunci: `ai_status_${p}` } });
  try {
    if (row) return JSON.parse(row.nilai) as StatusCadangan;
  } catch {
    /* rusak */
  }
  return { status: "belum_dicek", pesan: "", terakhirCoba: null, terakhirOk: null };
}

const TAHAN_CADANGAN: Partial<Record<KondisiAI, number>> = { belum_login: 10 * 60_000, limit: 30 * 60_000, tidak_ada: 10 * 60_000 };

// ---- model OpenRouter yang menolak akun ini (mis. "hanya untuk aplikasi agent") dilewati sementara di mode otomatis
const KUNCI_MODEL_BURUK = "ai_openrouter_model_buruk";
const LEWATI_MS = { rusak: 7 * 24 * 3600_000, sementara: 15 * 60_000 } as const;
/** Maksimal model yang dicoba dalam satu permintaan mode otomatis (supaya balasan tidak kelamaan). */
const MAKS_COBA_OR = 3;

async function bacaModelBuruk(db: Db, now: Date): Promise<Record<string, string>> {
  const row = await db.setting.findUnique({ where: { kunci: KUNCI_MODEL_BURUK } });
  try {
    const isi = row ? (JSON.parse(row.nilai) as Record<string, string>) : {};
    return Object.fromEntries(Object.entries(isi).filter(([, s]) => new Date(s) > now));
  } catch {
    return {};
  }
}

async function tandaiModelBuruk(db: Db, model: string, jenis: keyof typeof LEWATI_MS, now: Date) {
  const isi = { ...(await bacaModelBuruk(db, now)), [model]: new Date(now.getTime() + LEWATI_MS[jenis]).toISOString() };
  const nilai = JSON.stringify(isi);
  await db.setting.upsert({ where: { kunci: KUNCI_MODEL_BURUK }, update: { nilai }, create: { kunci: KUNCI_MODEL_BURUK, nilai } });
}

/** Maksimal model yang dicoba dalam satu permintaan (supaya balasan tidak kelamaan) dan batas waktu tiap model. */
const MAKS_PERCOBAAN = 4;
const TIMEOUT_PER_MODEL_MS = 30_000;

type RencanaModel = {
  daftar: string[];
  /** boleh pindah ke model lain kalau modelnya gagal */
  otomatis: boolean;
  /** dimuat sekali kalau `daftar` habis/kosong (mis. daftar model gratis dari jaringan) */
  muatTambahan?: () => Promise<string[]>;
};

/** Model gratis OpenRouter yang layak dicoba: cocok untuk foto (kalau perlu) dan belum ditandai menolak akun ini. */
async function modelGratisLayak(db: Db, r: PermintaanAI): Promise<string[]> {
  const semua = (await daftarModelGratis().catch(() => [])).filter((m) => !r.gambar || m.gambar).map((m) => m.id);
  const buruk = await bacaModelBuruk(db, r.now);
  const layak = semua.filter((id) => !buruk[id]);
  // kalau semuanya pernah ditandai, tetap coba daripada tidak sama sekali
  return layak.length ? layak : semua;
}

/**
 * Model yang akan dicoba berurutan. Model pilihan pemilik dulu; kalau gagal karena modelnya (penuh, timeout, ditutup),
 * pindah otomatis ke model lain yang terbukti paling andal (lihat modelOtomatis.ts). Saklar `ai_gemini_auto` /
 * `ai_openrouter_auto` mematikan perpindahan ini.
 */
async function modelCadangan(db: Db, p: PenyediaCadangan, r: PermintaanAI, kunci: string | null): Promise<RencanaModel> {
  if (r.model) return { daftar: [r.model], otomatis: false };
  const stat = await bacaStatistik(db);
  if (p === "gemini") {
    const utama = await getSetting(db, r.ringan ? "ai_gemini_model_ringan" : "ai_gemini_model");
    if ((await getSetting(db, "ai_gemini_auto")) === "0") return { daftar: utama ? [utama] : [], otomatis: false };
    // daftar model dari Google dimuat di latar belakang (tidak pernah menunda balasan); sebelum siap dipakai daftar tetap
    const ditemukan = daftarModelGeminiCache();
    if (!ditemukan && kunci) segarkanDaftarGemini(kunci);
    const calon = calonGemini(!!r.ringan, utama || undefined, ditemukan);
    return { daftar: urutkanModel("gemini", calon, utama || undefined, stat, r.now), otomatis: true };
  }
  if (p === "groq") {
    const utama = await getSetting(db, r.ringan ? "ai_groq_model_ringan" : "ai_groq_model");
    if ((await getSetting(db, "ai_groq_auto")) === "0") return { daftar: utama ? [utama] : [], otomatis: false };
    // daftar model dari Groq dimuat di latar belakang (tidak pernah menunda balasan); sebelum siap dipakai daftar tetap
    const ditemukan = daftarModelGroqCache();
    if (!ditemukan && kunci) segarkanDaftarGroq(kunci);
    return { daftar: urutkanModel("groq", calonGroq(!!r.ringan, utama || undefined, ditemukan), utama || undefined, stat, r.now), otomatis: true };
  }
  const pilih = await getSetting(db, "ai_openrouter_model");
  const auto = (await getSetting(db, "ai_openrouter_auto")) !== "0";
  if (pilih) {
    if (!modelGratis(pilih)) return { daftar: [], otomatis: false };
    if (!auto) return { daftar: [pilih], otomatis: false };
    // model pilihan dulu (kecuali sedang ditahan); daftar model gratis baru dimuat dari jaringan kalau memang perlu
    return {
      daftar: sedangDitahan("openrouter", pilih, stat, r.now) ? [] : [pilih],
      otomatis: true,
      muatTambahan: async () => urutkanModel("openrouter", (await modelGratisLayak(db, r)).filter((m) => m !== pilih), undefined, stat, r.now).slice(0, MAKS_COBA_OR),
    };
  }
  const calon = await modelGratisLayak(db, r);
  return { daftar: urutkanModel("openrouter", calon, undefined, stat, r.now).slice(0, MAKS_COBA_OR), otomatis: auto };
}

async function cobaCadangan(db: Db, p: PenyediaCadangan, r: PermintaanAI, utama: boolean): Promise<HasilCoba> {
  const tidak = (alasan: AlasanGagal, pesan: string) => ({ hasil: gagal(alasan, pesan), tercatat: false });
  const k = await kunciCadangan(db, p);
  if (!k.kunci && k.sumber !== "login") return tidak("belum_diatur", `${LABEL_PENYEDIA[p]} belum disambungkan.`);
  const st = await bacaStatusCadangan(db, p);
  const tahan = TAHAN_CADANGAN[st.status];
  if (!r.paksa && tahan && st.terakhirCoba && r.now.getTime() - new Date(st.terakhirCoba).getTime() < tahan) return tidak(st.status as AlasanGagal, st.pesan);
  const rencana = await modelCadangan(db, p, r, k.kunci);
  const { otomatis } = rencana;
  const antrian = [...rencana.daftar];
  let tambahanDimuat = false;
  if (!antrian.length && otomatis && rencana.muatTambahan) {
    tambahanDimuat = true;
    antrian.push(...(await rencana.muatTambahan().catch(() => [])));
  }
  if (!antrian.length) return tidak("gagal", p === "openrouter" ? "Belum ada model gratis OpenRouter yang cocok." : `Model ${LABEL_PENYEDIA[p]} belum diatur.`);

  const log = await db.aiCall.create({ data: { waktu: r.now, fitur: r.fitur, penyedia: p, utama, model: antrian[0], status: "berjalan" } });
  let hasil: HasilClaude = gagal("gagal", "Tidak ada model yang dicoba.");
  let model = antrian[0];
  const dilewati: string[] = [];
  const mulai = Date.now();
  const batasTotal = r.timeoutMs ?? 90_000;
  for (let i = 0; i < (otomatis ? MAKS_PERCOBAAN : 1); i++) {
    if (i >= antrian.length) {
      if (!otomatis || tambahanDimuat || !rencana.muatTambahan) break;
      tambahanDimuat = true;
      antrian.push(...(await rencana.muatTambahan().catch(() => [])).filter((x) => !antrian.includes(x)));
      if (i >= antrian.length) break;
    }
    if (i > 0 && Date.now() - mulai > batasTotal - 5_000) break; // sisa waktu tidak cukup untuk percobaan lagi
    const m = antrian[i];
    model = m;
    try {
      const dasar = { system: r.system, prompt: r.prompt, model: m, gambar: r.gambar, timeoutMs: otomatis ? Math.min(batasTotal, TIMEOUT_PER_MODEL_MS) : r.timeoutMs };
      hasil = await (p === "gemini" ? slot(() => penjalanGemini({ ...dasar, apiKey: k.kunci })) : p === "groq" ? penjalanGroqFn({ ...dasar, apiKey: k.kunci! }) : penjalanOR({ ...dasar, apiKey: k.kunci! }));
    } catch (e) {
      hasil = gagal("gagal", e instanceof Error ? e.message : String(e));
    }
    const jenis = hasil.ok ? null : jenisGagal(p, hasil);
    if (otomatis) await catatModel(db, p, m, hasil, jenis, r.now);
    if (hasil.ok || !otomatis) break;
    if (!jenis) break; // masalah akun/kunci/batas harian: model lain juga akan gagal
    if (p === "openrouter") await tandaiModelBuruk(db, m, jenis, r.now);
    dilewati.push(m);
  }
  if (dilewati.length && hasil.ok) hasil = { ...hasil, durasiMs: Date.now() - mulai };
  if (dilewati.length && !hasil.ok && dilewati.includes(model)) {
    hasil = { ...hasil, pesan: `Model ${p === "openrouter" ? "gratis " : ""}yang dicoba (${dilewati.join(", ")}) sedang tidak bisa dipakai. Dicoba lagi otomatis nanti, atau pilih model lain di "Urutan & model". Terakhir: ${hasil.pesan}`.slice(0, 500) };
  }
  await db.aiCall.update({
    where: { id: log.id },
    data: {
      model,
      status: hasil.ok ? "ok" : hasil.alasan,
      durasiMs: dilewati.length ? Date.now() - mulai : hasil.durasiMs,
      tokenMasuk: hasil.token?.masuk ?? 0,
      tokenKeluar: hasil.token?.keluar ?? 0,
      catatan: hasil.ok ? (dilewati.length ? `dilewati: ${dilewati.join(", ")}`.slice(0, 300) : null) : hasil.pesan.slice(0, 300),
    },
  });
  const iso = r.now.toISOString();
  // model pilihan yang gagal tidak mengubah status penyedia di panel (bisa jadi cuma salah nama model)
  if (!(r.model && !hasil.ok)) {
    const nilai = JSON.stringify({ status: (hasil.ok ? "ok" : hasil.alasan) as KondisiAI, pesan: hasil.ok ? "" : hasil.pesan, terakhirCoba: iso, terakhirOk: hasil.ok ? iso : st.terakhirOk, model } satisfies StatusCadangan);
    await db.setting.upsert({ where: { kunci: `ai_status_${p}` }, update: { nilai }, create: { kunci: `ai_status_${p}`, nilai } });
  }
  return { hasil, tercatat: true, model };
}

const LABEL_KONDISI_CADANGAN: Partial<Record<KondisiAI, string>> = {
  belum_login: "API key/login ditolak",
  limit: "Kena batas gratis",
  sibuk: "Server penyedia sibuk",
  timeout: "Lambat merespons",
  tidak_ada: "Gemini CLI belum terpasang",
  belum_diatur: "Belum disambungkan",
  gagal: "Gagal",
};

export const labelKondisiCadangan = (k: KondisiAI) => (k === "ok" ? "Aktif" : k === "belum_dicek" ? "Belum dicek" : (LABEL_KONDISI_CADANGAN[k] ?? LABEL_KONDISI[k] ?? k));

/** Ringkasan penyedia cadangan untuk halaman Koneksi, peta, dan status asisten. */
export async function statusCadangan(db: Db) {
  return Promise.all(
    CADANGAN.map(async (p) => {
      const [aktif, k, st, model] = await Promise.all([
        getSetting(db, `ai_${p}_aktif`),
        kunciCadangan(db, p),
        bacaStatusCadangan(db, p),
        getSetting(db, `ai_${p}_model`),
      ]);
      const ada = !!k.kunci || k.sumber === "login";
      const kondisi: KondisiAI = !ada ? "belum_diatur" : st.status;
      return {
        penyedia: p,
        label: LABEL_PENYEDIA[p],
        aktif: aktif === "1",
        ada,
        sumber: k.sumber,
        samaran: k.kunci ? samarkan(k.kunci) : null,
        rusak: k.rusak,
        kondisi,
        labelKondisi: labelKondisiCadangan(kondisi),
        siap: aktif === "1" && ada && !["belum_login", "limit", "tidak_ada", "belum_diatur"].includes(kondisi),
        model: model || (p === "openrouter" ? "otomatis (gratis)" : ""),
        modelTerakhir: st.model ?? null,
        pesan: st.pesan,
        terakhirOk: st.terakhirOk,
      };
    }),
  );
}
