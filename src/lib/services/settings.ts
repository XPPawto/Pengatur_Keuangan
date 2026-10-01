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
