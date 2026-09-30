import type { Db } from "../db";
import { normalizePhone, ownerNumbers } from "../whitelist";
import { AppError } from "./errors";

export type Peran = "pemilik" | "keluarga";

/**
 * Nomor di OWNER_WA_NUMBERS (.env) selalu jadi pemilik dan tidak bisa dihapus dari website.
 * Nomor tambahan (mis. orang tua) dikelola di halaman Pengaturan.
 */
export async function peranNomor(db: Db, raw: string): Promise<Peran | null> {
  const nomor = normalizePhone(raw);
  if (!nomor) return null;
  if (ownerNumbers().includes(nomor)) return "pemilik";
  const row = await db.allowedNumber.findUnique({ where: { nomor } });
  return row && row.aktif ? (row.peran as Peran) : null;
}

export interface Recipient {
  id: number | null;
  nomor: string;
  label: string;
  peran: Peran;
  terimaPengingat: boolean;
  terimaLaporan: boolean;
  terimaKonfirmasiUang: boolean;
  aktif: boolean;
  dariEnv: boolean;
}

export async function listRecipients(db: Db): Promise<Recipient[]> {
  const rows = await db.allowedNumber.findMany({ orderBy: { id: "asc" } });
  const env = ownerNumbers();
  const out: Recipient[] = rows.map((r) => ({
    id: r.id,
    nomor: r.nomor,
    label: r.label,
    peran: env.includes(r.nomor) ? "pemilik" : (r.peran as Peran),
    terimaPengingat: r.terimaPengingat,
    terimaLaporan: r.terimaLaporan,
    terimaKonfirmasiUang: r.terimaKonfirmasiUang,
    aktif: env.includes(r.nomor) ? true : r.aktif,
    dariEnv: env.includes(r.nomor),
  }));
  for (const n of env) {
    if (!out.some((r) => r.nomor === n)) {
      out.unshift({ id: null, nomor: n, label: `Nomor ${n.slice(-4)}`, peran: "pemilik", terimaPengingat: true, terimaLaporan: true, terimaKonfirmasiUang: false, aktif: true, dariEnv: true });
    }
  }
  return out;
}

type Filter = "pengingat" | "laporan" | "konfirmasiUang";

/** Nomor tujuan untuk pesan proaktif. */
export async function recipientsFor(db: Db, peran: Peran, filter?: Filter): Promise<string[]> {
  const all = await listRecipients(db);
  return all
    .filter((r) => r.aktif && r.peran === peran)
    .filter((r) => {
      if (filter === "pengingat") return r.terimaPengingat;
      if (filter === "laporan") return r.terimaLaporan;
      if (filter === "konfirmasiUang") return r.terimaKonfirmasiUang;
      return true;
    })
    .map((r) => r.nomor);
}

export interface RecipientInput {
  nomor: string;
  label: string;
  peran: Peran;
  terimaPengingat: boolean;
  terimaLaporan: boolean;
  terimaKonfirmasiUang: boolean;
  aktif?: boolean;
}

export async function saveRecipient(db: Db, r: RecipientInput) {
  const nomor = normalizePhone(r.nomor);
  if (!/^\d{9,15}$/.test(nomor)) throw new AppError("invalid", "Nomor tidak valid. Contoh: 0812xxxxxxxx.");
  const bot = await db.waConnection.findUnique({ where: { id: 1 } });
  if (bot?.nomorBot && bot.nomorBot === nomor) throw new AppError("invalid", "Itu nomor bot sendiri.");
  const peran: Peran = ownerNumbers().includes(nomor) ? "pemilik" : r.peran;
  const data = {
    label: r.label.trim() || `Nomor ${nomor.slice(-4)}`,
    peran,
    terimaPengingat: r.terimaPengingat,
    terimaLaporan: r.terimaLaporan,
    terimaKonfirmasiUang: r.terimaKonfirmasiUang,
    aktif: r.aktif ?? true,
  };
  return db.allowedNumber.upsert({ where: { nomor }, update: data, create: { nomor, ...data } });
}

export async function deleteRecipient(db: Db, nomorRaw: string) {
  const nomor = normalizePhone(nomorRaw);
  if (ownerNumbers().includes(nomor)) throw new AppError("invalid", "Nomor pemilik dari .env nggak bisa dihapus dari website.");
  await db.allowedNumber.deleteMany({ where: { nomor } });
}
