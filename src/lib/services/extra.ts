import type { Db } from "../db";
import { rp } from "../money";
import { fmtTanggalPanjang, namaHari, wibDate } from "../time";
import { ENVELOPE_KODE, type EnvelopeKode } from "../types";
import { logActivity, type Actor } from "./activity-log";
import { AppError } from "./errors";
import { enqueue } from "./outbox";
import { addBonus, getCurrentPeriod, getPeriodAllocations } from "./periods";
import { recipientsFor } from "./recipients";
import { getSetting } from "./settings";

export type Bagian = Partial<Record<EnvelopeKode, number>>;

const NAMA: Record<EnvelopeKode, string> = {
  makan: "Makan",
  data: "Paket data",
  paylater: "Paylater",
  kado: "Tabungan kado",
  darurat: "Darurat",
};

/** "kado:50,darurat:50" → { kado: 50, darurat: 50 } (persen). */
export function parseAturanBagi(s: string): Bagian {
  const out: Bagian = {};
  for (const part of s.split(",")) {
    const [k, v] = part.split(":").map((x) => x.trim());
    if (ENVELOPE_KODE.includes(k as EnvelopeKode) && Number(v) > 0) out[k as EnvelopeKode] = Number(v);
  }
  return Object.keys(out).length ? out : { darurat: 100 };
}

export function formatAturanBagi(b: Bagian): string {
  return (Object.entries(b) as [EnvelopeKode, number][]).map(([k, v]) => `${k}:${v}`).join(",");
}

/**
 * Bagi nominal sesuai persen. Hasil selalu bulat & jumlahnya pas (sisa pembulatan ke Darurat).
 * Kalau tabungan kado sudah tidak aktif (alokasi minggu ini 0), bagian kado dialihkan ke Darurat.
 */
export function bagiNominal(nominal: number, aturan: Bagian, kadoAktif = true): Bagian {
  const persen: Bagian = { ...aturan };
  if (!kadoAktif && persen.kado) {
    persen.darurat = (persen.darurat ?? 0) + persen.kado;
    delete persen.kado;
  }
  const total = Object.values(persen).reduce((a, b) => a + (b ?? 0), 0) || 100;
  const out: Bagian = {};
  let terpakai = 0;
  for (const [k, p] of Object.entries(persen) as [EnvelopeKode, number][]) {
    if (k === "darurat") continue;
    const n = Math.floor(((nominal * p) / total) / 100) * 100;
    if (n > 0) out[k] = n;
    terpakai += n;
  }
  out.darurat = nominal - terpakai;
  if (!out.darurat) delete out.darurat;
  return out;
}

export async function usulanBagi(db: Db, nominal: number): Promise<Bagian> {
  const period = await getCurrentPeriod(db);
  const aturan = parseAturanBagi(await getSetting(db, "bagi_ekstra"));
  const kadoAktif = period ? (await getPeriodAllocations(db, period.id)).kado > 0 : true;
  return bagiNominal(nominal, aturan, kadoAktif);
}

export function ringkasBagian(b: Bagian): string {
  return (Object.entries(b) as [EnvelopeKode, number][])
    .filter(([, n]) => n)
    .map(([k, n]) => `${NAMA[k]} ${rp(n)}`)
    .join(", ");
}

/** Normalisasi nama pengirim: "ayah"/"bapak"/"papa" → "Ayah", dst. */
export function namaPengirim(raw: string | null | undefined, fallback = "Ayah"): string {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return fallback;
  if (["ayah", "bapak", "papa", "abah", "papi", "bokap", "ayahanda"].includes(s)) return "Ayah";
  if (["ibu", "mama", "bunda", "umi", "mami", "nyokap", "emak"].includes(s)) return "Ibu";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export interface KirimanInput {
  dari: string;
  nominal: number;
  /** bagian per amplop; kosong = pakai aturan default */
  bagian?: Bagian;
  catatan?: string;
  actor: Actor;
  now: Date;
  /** kirim tanda terima ke nomor keluarga (default: true) */
  tandaTerima?: boolean;
}

/** Catat uang tambahan di luar uang mingguan (mis. kiriman Ayah). */
export async function catatKiriman(db: Db, k: KirimanInput) {
  if (!Number.isInteger(k.nominal) || k.nominal <= 0) throw new AppError("invalid", "Nominal kiriman tidak valid.");
  const period = await getCurrentPeriod(db);
  if (!period) throw new AppError("no_period", "Belum ada periode aktif. Catat uang mingguan dulu (`masuk 300`).");
  const bagian = k.bagian && Object.keys(k.bagian).length ? k.bagian : await usulanBagi(db, k.nominal);
  const jumlah = Object.values(bagian).reduce((a, b) => a + (b ?? 0), 0);
  if (jumlah !== k.nominal) throw new AppError("invalid", `Pembagian (${rp(jumlah)}) tidak sama dengan nominal (${rp(k.nominal)}).`);

  await addBonus(db, period.id, bagian);
  const row = await db.extraIncome.create({
    data: { periodId: period.id, dari: k.dari, nominal: k.nominal, bagian: JSON.stringify(bagian), catatan: k.catatan ?? "", oleh: k.actor.oleh, waktu: k.now },
  });
  await logActivity(db, k.actor, "kiriman", `Kiriman ${k.dari} ${rp(k.nominal)}: ${ringkasBagian(bagian)}`, {
    undo: { t: "kurangi_alokasi", periodId: period.id, bagian: bagian as Record<string, number>, extraIncomeId: row.id },
    now: k.now,
  });

  if (k.tandaTerima !== false) {
    const nama = await getSetting(db, "nama_pengguna");
    const tgl = wibDate(k.now);
    const isi = [
      "*Pemberitahuan DompetKos*",
      `Kiriman ${rp(k.nominal)} sudah diterima ${nama} pada ${namaHari(tgl)}, ${fmtTanggalPanjang(tgl)}. Terima kasih.`,
      "",
      `Rencana penggunaan: ${ringkasBagian(bagian).replace("Darurat", "dana darurat").replace("Tabungan kado", "tabungan")}.`,
      "",
      "_Pesan otomatis dari DompetKos._",
    ].join("\n");
    for (const nomor of await recipientsFor(db, "keluarga", "konfirmasiUang")) {
      await enqueue(db, { nomor, jenis: "konfirmasi_uang", isi, kunci: `kiriman:${row.id}:${nomor}` }, k.now);
    }
  }
  return { kiriman: row, bagian, period };
}

export async function listKiriman(db: Db, opts: { periodId?: number; take?: number } = {}) {
  return db.extraIncome.findMany({ where: { periodId: opts.periodId }, orderBy: { waktu: "desc" }, take: opts.take });
}

/** Ringkasan kiriman: total semua, total bulan ini, rata-rata per minggu (sejak kiriman pertama). */
export async function statistikKiriman(db: Db, now: Date) {
  const semua = await db.extraIncome.findMany({ orderBy: { waktu: "asc" } });
  const bulan = wibDate(now).slice(0, 7);
  const total = semua.reduce((a, k) => a + k.nominal, 0);
  const bulanIni = semua.filter((k) => wibDate(k.waktu).slice(0, 7) === bulan).reduce((a, k) => a + k.nominal, 0);
  const minggu = semua.length ? Math.max(1, Math.ceil((now.getTime() - semua[0].waktu.getTime()) / (7 * 86400_000))) : 1;
  const perDari = new Map<string, number>();
  for (const k of semua) perDari.set(k.dari, (perDari.get(k.dari) ?? 0) + k.nominal);
  return { total, bulanIni, jumlah: semua.length, rataPerMinggu: Math.round(total / minggu), perDari: [...perDari.entries()] };
}
