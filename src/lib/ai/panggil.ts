import type { Db } from "../db";
import { fmtTanggal, fromWib, HARI, wibDate, wibHM, wibWeekday } from "../time";
import { enqueue } from "../services/outbox";
import { recipientsFor } from "../services/recipients";
import { getSetting, getSettingNumber } from "../services/settings";
import { adaLoginFolder, JENDELA, penjalanCli, type AlasanGagal, type HasilClaude, type InfoBatas, type JendelaBatas, type NamaJendela, type Penjalan } from "./claude";
import { dekripsi, enkripsi, samarkan } from "./rahasia";
import { adaLoginGemini, penjalanGeminiCli, type PenjalanGemini } from "./gemini";
import { daftarModelGratis, modelGratis, penjalanOpenRouter, type PenjalanOpenRouter } from "./openrouter";

export type Penyedia = "claude" | "gemini" | "openrouter";
export const CADANGAN = ["gemini", "openrouter"] as const;
export type PenyediaCadangan = (typeof CADANGAN)[number];
export const LABEL_PENYEDIA: Record<Penyedia, string> = { claude: "Claude", gemini: "Gemini", openrouter: "OpenRouter" };
/** Hasil panggilan beserta penyedia yang akhirnya menjawab. */
export type HasilAI = HasilClaude & { penyedia?: Penyedia };

export type FiturAI = "chat_web" | "chat_wa" | "struk" | "kategori" | "review" | "cek";

export const LABEL_FITUR: Record<FiturAI, string> = {
  chat_web: "Chat website",
  chat_wa: "Asisten WhatsApp",
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
  return db.aiCall.count({ where: { waktu: { gte: fromWib(wibDate(now)) }, fitur: { not: "cek" }, utama: true } });
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
  /** hanya pakai penyedia ini (tes koneksi per penyedia) */
  penyedia?: Penyedia;
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
  if (r.fitur !== "cek") {
    const batas = await getSettingNumber(db, "ai_batas_harian");
    if ((await pemakaianHariIni(db, r.now)) >= batas) return gagal("kuota", `Batas ${batas} pemakaian AI hari ini udah habis.`);
  }
  const urutan = r.penyedia ? [r.penyedia] : await urutanPenyedia(db);
  if (!urutan.length) return gagal("belum_diatur", "Belum ada penyedia AI yang aktif.");
  const adaCadangan = urutan.filter((p) => p !== "claude").map((p) => LABEL_PENYEDIA[p]);

  let pertama: HasilAI | null = null;
  let tercatat = false;
  for (const p of urutan) {
    const c: { hasil: HasilClaude; tercatat: boolean } = p === "claude" ? await cobaClaude(db, r, !tercatat, adaCadangan) : await cobaCadangan(db, p, r, !tercatat);
    tercatat ||= c.tercatat;
    if (c.hasil.ok) return { ...c.hasil, penyedia: p };
    pertama ??= { ...c.hasil, penyedia: p };
  }
  return pertama!;
}

async function cobaClaude(db: Db, r: PermintaanAI, utama: boolean, cadangan: string[]): Promise<{ hasil: HasilClaude; tercatat: boolean }> {
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

  const model = await getSetting(db, r.ringan ? "ai_model_ringan" : "ai_model");
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
  await catatKondisi(db, st, hasil, r.now, cadangan);
  return { hasil, tercatat: true };
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

let penjalanGemini: PenjalanGemini = penjalanGeminiCli;
let penjalanOR: PenjalanOpenRouter = penjalanOpenRouter;
/** Ganti penjalan cadangan (dipakai tes). */
export function setPenjalanCadangan(p: { gemini?: PenjalanGemini; openrouter?: PenjalanOpenRouter }): () => void {
  const lama = { g: penjalanGemini, o: penjalanOR };
  if (p.gemini) penjalanGemini = p.gemini;
  if (p.openrouter) penjalanOR = p.openrouter;
  return () => {
    penjalanGemini = lama.g;
    penjalanOR = lama.o;
  };
}

const ENV_KUNCI: Record<PenyediaCadangan, string> = { gemini: "GEMINI_API_KEY", openrouter: "OPENROUTER_API_KEY" };

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

async function modelCadangan(db: Db, p: PenyediaCadangan, r: PermintaanAI): Promise<string | null> {
  if (p === "gemini") return getSetting(db, r.ringan ? "ai_gemini_model_ringan" : "ai_gemini_model");
  const pilih = await getSetting(db, "ai_openrouter_model");
  if (pilih) return modelGratis(pilih) ? pilih : null;
  // otomatis: model gratis dengan konteks terbesar (yang bisa membaca gambar kalau perlu)
  const daftar = await daftarModelGratis().catch(() => []);
  return (r.gambar ? daftar.find((m) => m.gambar) : daftar[0])?.id ?? null;
}

async function cobaCadangan(db: Db, p: PenyediaCadangan, r: PermintaanAI, utama: boolean): Promise<{ hasil: HasilClaude; tercatat: boolean }> {
  const tidak = (alasan: AlasanGagal, pesan: string) => ({ hasil: gagal(alasan, pesan), tercatat: false });
  const k = await kunciCadangan(db, p);
  if (!k.kunci && k.sumber !== "login") return tidak("belum_diatur", `${LABEL_PENYEDIA[p]} belum disambungkan.`);
  const st = await bacaStatusCadangan(db, p);
  const tahan = TAHAN_CADANGAN[st.status];
  if (!r.paksa && tahan && st.terakhirCoba && r.now.getTime() - new Date(st.terakhirCoba).getTime() < tahan) return tidak(st.status as AlasanGagal, st.pesan);
  const model = await modelCadangan(db, p, r);
  if (!model) return tidak("gagal", p === "openrouter" ? "Belum ada model gratis OpenRouter yang cocok." : "Model Gemini belum diatur.");

  const log = await db.aiCall.create({ data: { waktu: r.now, fitur: r.fitur, penyedia: p, utama, model, status: "berjalan" } });
  let hasil: HasilClaude;
  try {
    const dasar = { system: r.system, prompt: r.prompt, model, gambar: r.gambar, timeoutMs: r.timeoutMs, token: null };
    hasil = await (p === "gemini" ? slot(() => penjalanGemini({ ...dasar, apiKey: k.kunci })) : penjalanOR({ ...dasar, apiKey: k.kunci! }));
  } catch (e) {
    hasil = gagal("gagal", e instanceof Error ? e.message : String(e));
  }
  await db.aiCall.update({
    where: { id: log.id },
    data: { status: hasil.ok ? "ok" : hasil.alasan, durasiMs: hasil.durasiMs, tokenMasuk: hasil.token?.masuk ?? 0, tokenKeluar: hasil.token?.keluar ?? 0, catatan: hasil.ok ? null : hasil.pesan.slice(0, 300) },
  });
  const iso = r.now.toISOString();
  const nilai = JSON.stringify({ status: (hasil.ok ? "ok" : hasil.alasan) as KondisiAI, pesan: hasil.ok ? "" : hasil.pesan, terakhirCoba: iso, terakhirOk: hasil.ok ? iso : st.terakhirOk } satisfies StatusCadangan);
  await db.setting.upsert({ where: { kunci: `ai_status_${p}` }, update: { nilai }, create: { kunci: `ai_status_${p}`, nilai } });
  return { hasil, tercatat: true };
}

const LABEL_KONDISI_CADANGAN: Partial<Record<KondisiAI, string>> = {
  belum_login: "Kunci/login ditolak",
  limit: "Kena batas gratis",
  tidak_ada: "Gemini CLI belum terpasang",
  belum_diatur: "Belum disambungkan",
};

/** Ringkasan penyedia cadangan untuk halaman Koneksi, peta, dan status asisten. */
export async function statusCadangan(db: Db) {
  return Promise.all(
    CADANGAN.map(async (p) => {
      const [aktif, k, st, model] = await Promise.all([
        getSetting(db, `ai_${p}_aktif`),
        kunciCadangan(db, p),
        bacaStatusCadangan(db, p),
        getSetting(db, p === "gemini" ? "ai_gemini_model" : "ai_openrouter_model"),
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
        labelKondisi: kondisi === "ok" ? "Aktif" : kondisi === "belum_dicek" ? "Belum dicek" : (LABEL_KONDISI_CADANGAN[kondisi] ?? LABEL_KONDISI[kondisi] ?? kondisi),
        siap: aktif === "1" && ada && !["belum_login", "limit", "tidak_ada", "belum_diatur"].includes(kondisi),
        model: model || (p === "openrouter" ? "otomatis (gratis)" : ""),
        pesan: st.pesan,
        terakhirOk: st.terakhirOk,
      };
    }),
  );
}
