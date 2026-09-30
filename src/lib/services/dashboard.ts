import type { Db } from "../db";
import { diffDays, wibDate } from "../time";
import { getDailyStatus, getStreak } from "./daily";
import { getBalances } from "./envelopes";
import { getCurrentPeriod, getPendingPeriod, getPeriodAllocations } from "./periods";

export async function getDashboard(db: Db, now: Date) {
  const hariIni = wibDate(now);
  const [period, pending] = await Promise.all([getCurrentPeriod(db), getPendingPeriod(db)]);
  const [daily, balances, streak, bill, billPaylater, goal, pendingAlloc] = await Promise.all([
    getDailyStatus(db, now),
    getBalances(db, period?.id ?? null),
    getStreak(db, now),
    db.bill.findFirst({ where: { status: "belum" }, orderBy: { jatuhTempo: "asc" }, include: { envelope: true } }),
    db.bill.findFirst({ where: { status: "belum", envelope: { kode: "paylater" } }, orderBy: { jatuhTempo: "asc" } }),
    db.goal.findFirst({ include: { envelope: true } }),
    pending ? getPeriodAllocations(db, pending.id) : Promise.resolve(null),
  ]);

  const saldoKado = goal ? (balances.find((b) => b.id === goal.envelopeId)?.saldo ?? 0) : 0;

  return {
    hariIni,
    period,
    pending: pending && pendingAlloc ? { period: pending, alloc: pendingAlloc } : null,
    daily,
    balances,
    streak,
    billPaylater,
    bill: bill ? { ...bill, hariLagi: diffDays(hariIni, bill.jatuhTempo) } : null,
    goal: goal ? { ...goal, saldo: saldoKado, hariLagi: diffDays(hariIni, goal.tenggat) } : null,
  };
}
