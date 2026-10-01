import type { Db } from "../db";
import { fromWib, wibDate } from "../time";
import { enqueue } from "../services/outbox";
import { recipientsFor } from "../services/recipients";
import { getSetting, getSettingNumber } from "../services/settings";
import { adaLoginFolder, penjalanCli, type AlasanGagal, type HasilClaude, type Penjalan } from "./claude";
import { dekripsi, enkripsi, samarkan } from "./rahasia";

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
  const [aktif, batas, tersimpan, tok, pakai] = await Promise.all([
    getSetting(db, "ai_aktif"),
    getSettingNumber(db, "ai_batas_harian"),
    bacaStatus(db),
    getTokenAI(db),
    pemakaianHariIni(db, now),
  ]);
  const adaAkses = !!tok.token || tok.sumber === "folder";
  const kondisi: KondisiAI | "dimatikan" | "kuota" =
    aktif !== "1" ? "dimatikan" : !adaAkses ? "belum_diatur" : pakai >= batas ? "kuota" : tersimpan.status;
  return {
    aktif: aktif === "1",
    kondisi,
    label: LABEL_KONDISI[kondisi],
    pesan: tok.rusak ? "Token tersimpan tidak bisa dibuka (SESSION_SECRET berubah?). Simpan ulang tokennya." : tersimpan.pesan,
    siap: kondisi === "ok" || kondisi === "belum_dicek" || kondisi === "sibuk" || kondisi === "timeout" || kondisi === "gagal",
    token: { ada: adaAkses, sumber: tok.sumber, samaran: tok.token ? samarkan(tok.token) : null, rusak: tok.rusak },
    pemakaian: { hariIni: pakai, batas },
    sejak: tersimpan.sejak,
    terakhirOk: tersimpan.terakhirOk,
    terakhirCoba: tersimpan.terakhirCoba,
  };
}

/** Panggilan yang benar-benar dicoba hari ini (WIB). */
export async function pemakaianHariIni(db: Db, now: Date): Promise<number> {
  return db.aiCall.count({ where: { waktu: { gte: fromWib(wibDate(now)) }, fitur: { not: "cek" } } });
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
}

/**
 * Satu-satunya pintu ke Claude. Menjaga saklar, token, kuota harian, jeda setelah gagal, mencatat log,
 * dan mengabari pemilik sekali saat AI mati / pulih. Tidak pernah melempar error.
 */
export async function panggilAI(db: Db, r: PermintaanAI): Promise<HasilClaude> {
  const gagal = (alasan: AlasanGagal, pesan: string): HasilClaude => ({ ok: false, alasan, pesan, durasiMs: 0 });
  if ((await getSetting(db, "ai_aktif")) !== "1") return gagal("dimatikan", "Asisten AI dimatikan di Pengaturan.");

  const tok = await getTokenAI(db);
  if (!tok.token && tok.sumber !== "folder") {
    return gagal("belum_diatur", tok.rusak ? "Token tersimpan tidak bisa dibuka. Simpan ulang di halaman Asisten." : "Token Claude belum diatur.");
  }

  if (r.fitur !== "cek") {
    const batas = await getSettingNumber(db, "ai_batas_harian");
    if ((await pemakaianHariIni(db, r.now)) >= batas) return gagal("kuota", `Batas ${batas} pemakaian AI hari ini udah habis.`);
  }

  const st = await bacaStatus(db);
  const tahan = TAHAN_MS[st.status];
  if (!r.paksa && tahan && st.terakhirCoba && r.now.getTime() - new Date(st.terakhirCoba).getTime() < tahan) {
    return gagal(st.status as AlasanGagal, st.pesan);
  }

  const model = await getSetting(db, r.ringan ? "ai_model_ringan" : "ai_model");
  const hasil = await slot(() => penjalan({ system: r.system, prompt: r.prompt, model, gambar: r.gambar, timeoutMs: r.timeoutMs, token: tok.token }));

  await db.aiCall.create({
    data: {
      waktu: r.now,
      fitur: r.fitur,
      model,
      status: hasil.ok ? "ok" : hasil.alasan,
      durasiMs: hasil.durasiMs,
      tokenMasuk: hasil.token?.masuk ?? 0,
      tokenKeluar: hasil.token?.keluar ?? 0,
      catatan: hasil.ok ? null : hasil.pesan.slice(0, 300),
    },
  });
  await catatKondisi(db, st, hasil, r.now);
  return hasil;
}

async function catatKondisi(db: Db, lama: StatusTersimpan, h: HasilClaude, now: Date) {
  const baru: KondisiAI = h.ok ? "ok" : (h.alasan as KondisiAI);
  const iso = now.toISOString();
  await simpanStatus(db, {
    status: baru,
    pesan: h.ok ? "" : h.pesan,
    sejak: baru === lama.status ? lama.sejak : iso,
    terakhirCoba: iso,
    terakhirOk: h.ok ? iso : lama.terakhirOk,
  });

  const pemilik = await recipientsFor(db, "pemilik");
  if (!h.ok && DIKABARI.includes(baru) && baru !== lama.status) {
    const isi = KABAR[baru as keyof typeof KABAR];
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
export async function tesKoneksiAI(db: Db, now: Date): Promise<HasilClaude> {
  return panggilAI(db, { fitur: "cek", system: "Balas persis satu kata: siap", prompt: "tes", ringan: true, now, paksa: true, timeoutMs: 60_000 });
}

/**
 * Dijalankan bot tiap 30 menit: kalau AI sedang mati karena token/limit/CLI, coba lagi pelan-pelan supaya
 * begitu pemilik memperbaiki token (atau limit reset), AI nyala sendiri dan pemilik dikabari.
 */
export async function cekPulihAI(db: Db, now: Date): Promise<boolean> {
  if ((await getSetting(db, "ai_aktif")) !== "1") return false;
  const st = await bacaStatus(db);
  if (!DIKABARI.includes(st.status)) return false;
  const tahan = TAHAN_MS[st.status] ?? 0;
  if (st.terakhirCoba && now.getTime() - new Date(st.terakhirCoba).getTime() < tahan) return false;
  const h = await panggilAI(db, { fitur: "cek", system: "Balas persis satu kata: siap", prompt: "tes", ringan: true, now, timeoutMs: 60_000 });
  return h.ok;
}
