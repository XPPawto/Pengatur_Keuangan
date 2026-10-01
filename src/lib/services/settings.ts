import type { Db } from "../db";

export const DEFAULT_SETTINGS = {
  nama_pengguna: "Abdul",
  /** Pengeluaran Darurat di atas nominal ini masuk mode tahan belanja dulu. */
  batas_tahan: "25000",
  /** Izinkan login website pakai kode yang dikirim ke WhatsApp. */
  otp_login: "1",
  /** Pembagian default uang tambahan (kiriman Ayah, uang ekstra), dalam persen per amplop. */
  bagi_ekstra: "kado:50,darurat:50",
  /** Nama pengirim default untuk kiriman tambahan. */
  pengirim_default: "Ayah",
  /** Asisten AI (Claude Code CLI dengan token langganan). */
  ai_aktif: "1",
  /** Maksimal pemanggilan AI per hari (menjaga kuota langganan). */
  ai_batas_harian: "40",
  /** Model untuk ngobrol, struk, review (alias Claude Code: sonnet | opus | haiku). */
  ai_model: "sonnet",
  /** Model untuk tugas kecil (tebak kategori, cek koneksi). */
  ai_model_ringan: "haiku",
  /** AI menjawab pesan WhatsApp yang tidak dipahami perintah biasa. */
  ai_pesan_bebas: "1",
  /** Foto struk dibaca Claude (fallback OCR lokal). */
  ai_struk: "1",
  /** Evaluasi & tantangan dari AI di rekap Sabtu. */
  ai_review: "1",
  /** AI menebak amplop untuk kata yang belum dikenal. */
  ai_tebak_kategori: "1",
  /** Penyedia AI cadangan saat Claude tidak bisa dipakai. */
  ai_claude_aktif: "1",
  ai_gemini_aktif: "0",
  ai_gemini_model: "gemini-3.6-flash",
  ai_gemini_model_ringan: "gemini-3.5-flash-lite",
  /** pindah ke model lain otomatis kalau model yang dipilih penuh / timeout / ditutup (Gemini & OpenRouter) */
  ai_gemini_auto: "1",
  ai_openrouter_auto: "1",
  ai_openrouter_aktif: "0",
  /** wajib model gratis (berakhiran ":free"); kosong = pilih otomatis model gratis pertama */
  ai_openrouter_model: "",
  /** urutan cadangan setelah Claude */
  ai_urutan_cadangan: "gemini,openrouter",
} as const;
export type SettingKey = keyof typeof DEFAULT_SETTINGS;

export async function getSetting(db: Db, key: SettingKey): Promise<string> {
  const row = await db.setting.findUnique({ where: { kunci: key } });
  return row?.nilai ?? DEFAULT_SETTINGS[key];
}

export async function getSettingNumber(db: Db, key: SettingKey): Promise<number> {
  const n = Number(await getSetting(db, key));
  return Number.isFinite(n) ? n : Number(DEFAULT_SETTINGS[key]);
}

export async function setSetting(db: Db, key: SettingKey, nilai: string) {
  await db.setting.upsert({ where: { kunci: key }, update: { nilai }, create: { kunci: key, nilai } });
}

export async function getAllSettings(db: Db): Promise<Record<SettingKey, string>> {
  const rows = await db.setting.findMany();
  const out = { ...DEFAULT_SETTINGS } as Record<SettingKey, string>;
  for (const r of rows) if (r.kunci in out) out[r.kunci as SettingKey] = r.nilai;
  return out;
}
