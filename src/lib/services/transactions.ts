import type { Db } from "../db";
import { KATA_BUKA_KUNCI, type EnvelopeKode, type Sumber } from "../types";
import { wibDate } from "../time";
import { AppError } from "./errors";
import { syncDailyLog } from "./daily";
import { getBalances, type EnvelopeBalance } from "./envelopes";
import { getCurrentPeriod } from "./periods";

export interface RecordInput {
  kode: EnvelopeKode;
  nominal: number;
  catatan?: string;
  sumber: Sumber;
  pesanAsli?: string;
  now: Date;
  /** tanggal WIB transaksi kalau bukan hari ini (mis. `kemarin tempe 5k`); harus di dalam periode aktif */
  tanggal?: string;
  /** wajib diisi "YAKIN AMBIL TABUNGAN" untuk amplop terkunci */
  konfirmasiBukaKunci?: string;
}

export interface RecordResult {
  id: number;
  nominal: number;
  catatan: string;
  saldoSebelum: number;
  balance: EnvelopeBalance;
  /** peringatan: amplop baru saja turun di bawah 20% alokasi */
  melewatiBatas20: boolean;
}

export async function recordExpense(db: Db, input: RecordInput): Promise<RecordResult> {
  if (!Number.isInteger(input.nominal) || input.nominal <= 0) throw new AppError("invalid", "Nominal harus lebih dari 0.");
  const period = await getCurrentPeriod(db);
  if (!period) throw new AppError("no_period", "Belum ada periode aktif. Balas `masuk 300` dulu.");
  const env = await db.envelope.findUnique({ where: { kode: input.kode } });
  if (!env) throw new AppError("not_found", "Amplop tidak ditemukan.");

  if (env.terkunci && input.konfirmasiBukaKunci?.trim().toUpperCase() !== KATA_BUKA_KUNCI) {
    throw new AppError("locked", `${env.nama} terkunci. Ketik "${KATA_BUKA_KUNCI}" buat lanjut.`);
  }

  const tanggal = input.tanggal ?? wibDate(input.now);
  if (input.tanggal && (tanggal < period.tanggalMulai || tanggal > wibDate(input.now))) {
    throw new AppError("invalid", "Tanggal itu di luar periode aktif. Catat lewat website kalau perlu.");
  }

  const before = (await getBalances(db, period.id)).find((b) => b.kode === input.kode)!;
  const tx = await db.transaction.create({
    data: {
      periodId: period.id,
      envelopeId: env.id,
      nominal: input.nominal,
      jenis: "keluar",
      catatan: (input.catatan ?? "").trim(),
      sumber: input.sumber,
      pesanAsli: input.pesanAsli,
      tanggal,
      dibuatPada: input.now,
    },
  });
  await syncDailyLog(db, tx.tanggal, input.now);
  const after = (await getBalances(db, period.id)).find((b) => b.kode === input.kode)!;

  const batas = Math.floor(before.alokasi * 0.2);
  const cekBatas = before.jenis === "daily" || before.jenis === "fixed";
  return {
    id: tx.id,
    nominal: tx.nominal,
    catatan: tx.catatan,
    saldoSebelum: before.saldo,
    balance: after,
    melewatiBatas20: cekBatas && before.alokasi > 0 && before.saldo >= batas && after.saldo < batas,
  };
}

export async function lastTransaction(db: Db) {
  return db.transaction.findFirst({ orderBy: [{ dibuatPada: "desc" }, { id: "desc" }], include: { envelope: true } });
}

export async function deleteTransaction(db: Db, id: number, now: Date) {
  const tx = await db.transaction.findUnique({ where: { id } });
  if (!tx) throw new AppError("not_found", "Transaksi tidak ditemukan.");
  await db.transaction.delete({ where: { id } });
  await syncDailyLog(db, tx.tanggal, now);
  return tx;
}

export async function updateTransaction(
  db: Db,
  id: number,
  data: { nominal?: number; catatan?: string; kode?: EnvelopeKode; konfirmasiBukaKunci?: string },
  now: Date,
) {
  const tx = await db.transaction.findUnique({ where: { id }, include: { envelope: true } });
  if (!tx) throw new AppError("not_found", "Transaksi tidak ditemukan.");
  if (data.nominal !== undefined && (!Number.isInteger(data.nominal) || data.nominal <= 0)) {
    throw new AppError("invalid", "Nominal harus lebih dari 0.");
  }
  let envelopeId = tx.envelopeId;
  if (data.kode && data.kode !== tx.envelope.kode) {
    const env = await db.envelope.findUnique({ where: { kode: data.kode } });
    if (!env) throw new AppError("not_found", "Amplop tidak ditemukan.");
    if (env.terkunci && data.konfirmasiBukaKunci?.trim().toUpperCase() !== KATA_BUKA_KUNCI) {
      throw new AppError("locked", `${env.nama} terkunci. Ketik "${KATA_BUKA_KUNCI}" buat lanjut.`);
    }
    envelopeId = env.id;
  }
  await db.transaction.update({
    where: { id },
    data: { nominal: data.nominal ?? tx.nominal, catatan: data.catatan ?? tx.catatan, envelopeId },
  });
  await syncDailyLog(db, tx.tanggal, now);
}

export interface ListFilter {
  periodId?: number;
  kode?: EnvelopeKode;
  tanggal?: string;
  limit?: number;
}

export async function listTransactions(db: Db, f: ListFilter = {}) {
  return db.transaction.findMany({
    where: {
      periodId: f.periodId,
      tanggal: f.tanggal,
      envelope: f.kode ? { kode: f.kode } : undefined,
    },
    include: { envelope: true },
    orderBy: [{ tanggal: "desc" }, { dibuatPada: "desc" }, { id: "desc" }],
    take: f.limit,
  });
}
