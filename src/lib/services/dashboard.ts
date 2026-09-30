import type { Db } from "../db";
import { diffDays, wibDate } from "../time";
import { getDailyStatus, getStreak } from "./daily";
import { getBalances } from "./envelopes";
import { getGoalProgress } from "./goals";
import { savedTotal } from "./holds";
import { getCurrentPeriod, getPendingPeriod, getPeriodAllocations } from "./periods";
import { listTransactions } from "./transactions";

export async function getDashboard(db: Db, now: Date) {
  const hariIni = wibDate(now);
  const [period, pending] = await Promise.all([getCurrentPeriod(db), getPendingPeriod(db)]);
  const [daily, balances, streak, bills, billPaylater, goal, pendingAlloc, hemat, txHariIni, holdsMenunggu] = await Promise.all([
    getDailyStatus(db, now),
    getBalances(db, period?.id ?? null),
    getStreak(db, now),
    db.bill.findMany({ where: { status: "belum" }, orderBy: { jatuhTempo: "asc" }, include: { envelope: true }, take: 3 }),
    db.bill.findFirst({ where: { status: "belum", envelope: { kode: "paylater" } }, orderBy: { jatuhTempo: "asc" } }),
    getGoalProgress(db, now),
    pending ? getPeriodAllocations(db, pending.id) : Promise.resolve(null),
    savedTotal(db),
    listTransactions(db, { tanggal: hariIni, limit: 6 }),
    db.holdRequest.count({ where: { hasil: "menunggu" } }),
  ]);

  return {
    hariIni,
    period,
    pending: pending && pendingAlloc ? { period: pending, alloc: pendingAlloc } : null,
    daily,
    balances,
    streak,
    billPaylater,
    bills: bills.map((b) => ({ ...b, hariLagi: diffDays(hariIni, b.jatuhTempo) })),
    goal,
    hemat,
    txHariIni,
    holdsMenunggu,
  };
}
