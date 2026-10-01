import type { Db } from "../db";
import { KATA_BUKA_KUNCI, type EnvelopeKode, type Sumber } from "../types";
import { wibDate } from "../time";
import { AppError } from "./errors";
import { syncDailyLog } from "./daily";
import { getBalances, type EnvelopeBalance } from "./envelopes";
import { getCurrentPeriod } from "./periods";
import { logActivity, snapTx, type Actor } from "./activity-log";
import { rp } from "../money";

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
  /** pencatat aksi; default diambil dari `sumber` */
  actor?: Actor;
  /** false = pemanggil mencatat aktivitasnya sendiri (mis. satu pesan berisi banyak item) */
  log?: boolean;
  billId?: number;
  debtId?: number;
  jenis?: "keluar" | "koreksi";
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
      jenis: input.jenis ?? "keluar",
      billId: input.billId ?? null,
      debtId: input.debtId ?? null,
      catatan: (input.catatan ?? "").trim(),
      sumber: input.sumber,
      pesanAsli: input.pesanAsli,
      tanggal,
      dibuatPada: input.now,
    },
  });
  await syncDailyLog(db, tx.tanggal, input.now);
  const after = (await getBalances(db, period.id)).find((b) => b.kode === input.kode)!;
  if (input.log !== false) {
    const actor = input.actor ?? { oleh: input.sumber, sumber: input.sumber };
    await logActivity(db, actor, "catat", `Catat ${tx.catatan || "pengeluaran"} ${rp(tx.nominal)} ke ${env.nama}`, {
      undo: { t: "hapus_tx", ids: [tx.id] },
      now: input.now,
    });
  }

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

/**
 * Hapus transaksi. Kalau transaksi itu pembayaran tagihan, tagihannya kembali "belum lunas".
 * Isi lengkapnya disimpan di riwayat aktivitas, jadi bisa dipulihkan.
 */
export async function deleteTransaction(db: Db, id: number, now: Date, actor?: Actor, opts: { log?: boolean } = {}) {
  const tx = await db.transaction.findUnique({ where: { id }, include: { envelope: true } });
  if (!tx) throw new AppError("not_found", "Transaksi tidak ditemukan.");
  await db.transaction.delete({ where: { id } });
  const lunasKembali: number[] = [];
  if (tx.billId) {
    const bill = await db.bill.findUnique({ where: { id: tx.billId } });
    if (bill?.status === "lunas") {
      await db.bill.update({ where: { id: bill.id }, data: { status: "belum", dibayarPada: null } });
      lunasKembali.push(bill.id);
    }
  }
  await syncDailyLog(db, tx.tanggal, now);
  if (opts.log !== false) {
    await logActivity(db, actor ?? { oleh: "web", sumber: "web" }, "hapus_transaksi", `Hapus ${tx.catatan || "pengeluaran"} ${rp(tx.nominal)} (${tx.envelope.nama})${lunasKembali.length ? ", tagihan kembali belum lunas" : ""}`, {
      undo: { t: "pulihkan_tx", rows: [snapTx(tx)], lunasKembali },
      now,
    });
  }
  return tx;
}

export async function updateTransaction(
  db: Db,
  id: number,
  data: { nominal?: number; catatan?: string; kode?: EnvelopeKode; konfirmasiBukaKunci?: string },
  now: Date,
  actor?: Actor,
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
  if (tx.billId && data.nominal !== undefined) await db.bill.update({ where: { id: tx.billId }, data: { nominal: data.nominal } });
  await syncDailyLog(db, tx.tanggal, now);
  const baru = data.nominal ?? tx.nominal;
  await logActivity(db, actor ?? { oleh: "web", sumber: "web" }, "ubah_transaksi", `Ubah ${tx.catatan || "pengeluaran"}: ${rp(tx.nominal)} → ${rp(baru)}${envelopeId !== tx.envelopeId ? ", pindah amplop" : ""}`, {
    undo: { t: "kembalikan_tx", id, sebelum: { nominal: tx.nominal, catatan: tx.catatan, envelopeId: tx.envelopeId } },
    now,
  });
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
