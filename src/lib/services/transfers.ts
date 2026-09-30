import type { Db } from "../db";
import { KATA_BUKA_KUNCI, type EnvelopeKode, type Sumber } from "../types";
import { AppError } from "./errors";
import { getBalances } from "./envelopes";
import { getCurrentPeriod } from "./periods";

export interface TransferInput {
  dari: EnvelopeKode;
  ke: EnvelopeKode;
  nominal: number;
  alasan: string;
  now: Date;
  sumber?: Sumber;
  konfirmasiBukaKunci?: string;
}

/** Pindah uang antar amplop. Selalu tercatat beserta alasannya. Ambil dari amplop terkunci butuh kata konfirmasi. */
export async function transferBetween(db: Db, t: TransferInput) {
  if (t.dari === t.ke) throw new AppError("invalid", "Amplop asal dan tujuan nggak boleh sama.");
  if (!Number.isInteger(t.nominal) || t.nominal <= 0) throw new AppError("invalid", "Nominal harus lebih dari 0.");
  if (!t.alasan.trim()) throw new AppError("invalid", "Alasan pindah wajib diisi.");
  const period = await getCurrentPeriod(db);
  if (!period) throw new AppError("no_period", "Belum ada periode aktif.");
  const [dari, ke] = await Promise.all([
    db.envelope.findUnique({ where: { kode: t.dari } }),
    db.envelope.findUnique({ where: { kode: t.ke } }),
  ]);
  if (!dari || !ke) throw new AppError("not_found", "Amplop tidak ditemukan.");
  if (dari.terkunci && t.konfirmasiBukaKunci?.trim().toUpperCase() !== KATA_BUKA_KUNCI) {
    throw new AppError("locked", `${dari.nama} terkunci. Ketik "${KATA_BUKA_KUNCI}" buat lanjut.`);
  }
  const tr = await db.transfer.create({
    data: { periodId: period.id, dariEnvelopeId: dari.id, keEnvelopeId: ke.id, nominal: t.nominal, alasan: t.alasan.trim(), dibuatPada: t.now },
  });
  const balances = await getBalances(db, period.id);
  return {
    transfer: tr,
    saldoDari: balances.find((b) => b.kode === t.dari)!.saldo,
    saldoKe: balances.find((b) => b.kode === t.ke)!.saldo,
    namaDari: dari.nama,
    namaKe: ke.nama,
  };
}
