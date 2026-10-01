import type { Db } from "../db";
import { AppError } from "./errors";
import { logActivity, type Actor, type Undo } from "./activity-log";
import { syncDailyLog } from "./daily";
import { ENVELOPE_KODE } from "../types";

export async function listActivities(db: Db, opts: { take?: number; skip?: number } = {}) {
  return db.activityLog.findMany({ orderBy: [{ waktu: "desc" }, { id: "desc" }], take: opts.take ?? 50, skip: opts.skip });
}

/** Aksi terakhir yang masih bisa dibatalkan (siapa pun pelakunya, karena datanya dipakai bersama). */
export async function lastUndoable(db: Db) {
  return db.activityLog.findFirst({
    where: { undo: { not: null }, dibatalkanPada: null },
    orderBy: [{ waktu: "desc" }, { id: "desc" }],
  });
}

async function kurangiAlokasi(db: Db, periodId: number, bagian: Record<string, number>) {
  const envs = await db.envelope.findMany();
  let total = 0;
  for (const [kode, n] of Object.entries(bagian)) {
    const env = envs.find((e) => e.kode === kode);
    if (!env || !n) continue;
    const a = await db.allocation.findUnique({ where: { periodId_envelopeId: { periodId, envelopeId: env.id } } });
    if (!a) continue;
    await db.allocation.update({ where: { id: a.id }, data: { nominal: a.nominal - n } });
    total += n;
  }
  if (total) await db.period.update({ where: { id: periodId }, data: { tambahan: { decrement: total } } });
}

async function jalankan(db: Db, u: Undo, now: Date) {
  switch (u.t) {
    case "hapus_tx": {
      const txs = await db.transaction.findMany({ where: { id: { in: u.ids } } });
      await db.transaction.deleteMany({ where: { id: { in: u.ids } } });
      for (const tgl of new Set(txs.map((t) => t.tanggal))) await syncDailyLog(db, tgl, now);
      return;
    }
    case "pulihkan_tx": {
      for (const r of u.rows) {
        const ada = await db.transaction.findUnique({ where: { id: r.id } });
        const periodAda = await db.period.findUnique({ where: { id: r.periodId } });
        if (ada || !periodAda) continue;
        await db.transaction.create({ data: { ...r, dibuatPada: new Date(r.dibuatPada) } });
        await syncDailyLog(db, r.tanggal, now);
      }
      for (const billId of u.lunasKembali ?? []) {
        await db.bill.updateMany({ where: { id: billId }, data: { status: "lunas", dibayarPada: now } });
      }
      return;
    }
    case "kembalikan_tx": {
      const tx = await db.transaction.findUnique({ where: { id: u.id } });
      if (!tx) throw new AppError("not_found", "Transaksinya sudah tidak ada.");
      await db.transaction.update({ where: { id: u.id }, data: u.sebelum });
      if (tx.billId) await db.bill.update({ where: { id: tx.billId }, data: { nominal: u.sebelum.nominal } });
      await syncDailyLog(db, tx.tanggal, now);
      return;
    }
    case "hapus_transfer":
      await db.transfer.deleteMany({ where: { id: { in: u.ids } } });
      return;
    case "pulihkan_transfer":
      for (const r of u.rows) {
        if (await db.transfer.findUnique({ where: { id: r.id } })) continue;
        if (!(await db.period.findUnique({ where: { id: r.periodId } }))) continue;
        await db.transfer.create({ data: { ...r, dibuatPada: new Date(r.dibuatPada) } });
      }
      return;
    case "batal_bayar": {
      if (u.txId) {
        const tx = await db.transaction.findUnique({ where: { id: u.txId } });
        await db.transaction.deleteMany({ where: { id: u.txId } });
        if (tx) await syncDailyLog(db, tx.tanggal, now);
      }
      await db.bill.updateMany({ where: { id: u.billId }, data: { status: "belum", dibayarPada: null, nominal: u.nominalSebelum } });
      return;
    }
    case "batal_periode": {
      const jumlahTx = await db.transaction.count({ where: { periodId: u.periodId } });
      if (jumlahTx > 0) {
        throw new AppError("invalid", "Periode itu sudah ada transaksinya, jadi nggak bisa dibatalkan. Koreksi nominalnya di website (Amplop → Koreksi uang masuk).");
      }
      await db.transfer.deleteMany({ where: { id: { in: u.transferIds } } });
      await db.period.deleteMany({ where: { id: u.periodId } });
      await db.period.updateMany({ where: { id: { in: u.periodeLamaIds } }, data: { status: "aktif" } });
      await db.extraIncome.deleteMany({ where: { periodId: u.periodId } });
      return;
    }
    case "kurangi_alokasi":
      await kurangiAlokasi(db, u.periodId, u.bagian);
      if (u.extraIncomeId) {
        await db.extraIncome.deleteMany({ where: { id: u.extraIncomeId } });
        // tanda terima yang belum terkirim ikut dibatalkan
        await db.outbox.updateMany({ where: { kunci: { startsWith: `kiriman:${u.extraIncomeId}:` }, status: "antri" }, data: { status: "batal", catatan: "Kiriman dibatalkan" } });
      }
      return;
    case "batal_patungan": {
      const txs = await db.transaction.findMany({ where: { id: { in: u.txIds } } });
      await db.transaction.deleteMany({ where: { id: { in: u.txIds } } });
      await db.debt.deleteMany({ where: { id: { in: u.debtIds } } });
      for (const tgl of new Set(txs.map((t) => t.tanggal))) await syncDailyLog(db, tgl, now);
      return;
    }
    case "jalankan_saran":
      await db.transfer.deleteMany({ where: { id: { in: u.transferIds } } });
      return;
    case "tanpa_jajan_off":
      await db.dailyLog.updateMany({ where: { tanggal: u.tanggal }, data: { tanpaJajan: u.sebelum } });
      await syncDailyLog(db, u.tanggal, now);
      return;
    case "hold_menunggu": {
      if (u.txId) await db.transaction.deleteMany({ where: { id: u.txId } });
      await db.holdRequest.updateMany({ where: { id: u.holdId }, data: { hasil: "menunggu", diputuskanPada: null } });
      return;
    }
    case "batal_debt":
      await db.transaction.deleteMany({ where: { id: { in: u.txIds } } });
      if (u.periodId) await kurangiAlokasi(db, u.periodId, u.bagian);
      await db.debt.deleteMany({ where: { id: u.debtId } });
      return;
    case "batal_debt_bayar":
      await db.transaction.deleteMany({ where: { id: { in: u.txIds } } });
      if (u.periodId) await kurangiAlokasi(db, u.periodId, u.bagian);
      await db.debtPayment.deleteMany({ where: { id: u.paymentId } });
      await db.debt.updateMany({ where: { id: u.debtId }, data: { status: u.statusSebelum, lunasPada: null } });
      return;
    case "pemasukan": {
      const envs = await db.envelope.findMany();
      for (const kode of ENVELOPE_KODE) {
        const env = envs.find((e) => e.kode === kode);
        const n = u.alokasiSebelum[kode];
        if (!env || n === undefined) continue;
        await db.allocation.updateMany({ where: { periodId: u.periodId, envelopeId: env.id }, data: { nominal: n } });
      }
      await db.period.update({ where: { id: u.periodId }, data: { pemasukan: u.pemasukanSebelum } });
      return;
    }
  }
}

/** Batalkan satu aksi dari riwayat. Pembatalan sendiri juga tercatat. */
export async function undoActivity(db: Db, id: number, actor: Actor, now: Date) {
  const log = await db.activityLog.findUnique({ where: { id } });
  if (!log) throw new AppError("not_found", "Aktivitas tidak ditemukan.");
  if (log.dibatalkanPada) throw new AppError("invalid", "Aksi itu sudah dibatalkan.");
  if (!log.undo) throw new AppError("invalid", "Aksi ini tidak bisa dibatalkan.");
  await jalankan(db, JSON.parse(log.undo) as Undo, now);
  await db.activityLog.update({ where: { id }, data: { dibatalkanPada: now, dibatalkanOleh: actor.oleh } });
  await logActivity(db, actor, "batal", `Batalkan: ${log.ringkasan}`, { now, data: { aktivitasId: id } });
  return log;
}
