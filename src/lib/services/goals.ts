import type { Db } from "../db";
import { addDays, diffDays, sundayOnOrBefore, wibDate } from "../time";
import { getBalances } from "./envelopes";
import { getCurrentPeriod } from "./periods";
import { AppError } from "./errors";

export interface GoalPoint {
  minggu: string;
  rencana: number;
  aktual: number | null;
}

export type GoalStatus = "tercapai" | "ideal" | "aman" | "kurang";

export async function getGoalProgress(db: Db, now: Date) {
  const goal = await db.goal.findFirst({ include: { envelope: true } });
  if (!goal) return null;
  const today = wibDate(now);
  const period = await getCurrentPeriod(db);
  const balances = await getBalances(db, period?.id ?? null);
  const saldo = balances.find((b) => b.id === goal.envelopeId)?.saldo ?? 0;

  const [plans, periods, allocs, txs, transfers] = await Promise.all([
    db.allocationPlan.findMany({ where: { envelopeId: goal.envelopeId }, orderBy: { tanggalMulai: "asc" } }),
    db.period.findMany({ where: { status: { not: "menunggu" } }, orderBy: { tanggalMulai: "asc" } }),
    db.allocation.findMany({ where: { envelopeId: goal.envelopeId } }),
    db.transaction.findMany({ where: { envelopeId: goal.envelopeId } }),
    db.transfer.findMany({ where: { OR: [{ dariEnvelopeId: goal.envelopeId }, { keEnvelopeId: goal.envelopeId }] } }),
  ]);

  // perubahan saldo kado per periode
  const delta = new Map<number, number>();
  for (const p of periods) {
    const a = allocs.filter((x) => x.periodId === p.id).reduce((s, x) => s + x.nominal, 0);
    const t = txs.filter((x) => x.periodId === p.id).reduce((s, x) => s + x.nominal, 0);
    const tin = transfers.filter((x) => x.periodId === p.id && x.keEnvelopeId === goal.envelopeId).reduce((s, x) => s + x.nominal, 0);
    const tout = transfers.filter((x) => x.periodId === p.id && x.dariEnvelopeId === goal.envelopeId).reduce((s, x) => s + x.nominal, 0);
    delta.set(p.id, a - t + tin - tout);
  }

  // setoran rencana yang belum terjadi (periode setelah minggu ini, sampai tenggat)
  const mingguIni = sundayOnOrBefore(today);
  const batasBawah = period && period.tanggalMulai >= mingguIni ? period.tanggalMulai : addDays(mingguIni, -1);
  const akanDatang = plans.filter((p) => p.tanggalMulai > batasBawah && p.tanggalMulai <= goal.tenggat && p.nominal > 0);
  const proyeksi = saldo + akanDatang.reduce((s, p) => s + p.nominal, 0);

  let estimasiTercapai: string | null = null;
  if (saldo >= goal.targetMin) estimasiTercapai = today;
  else {
    let c = saldo;
    for (const p of akanDatang) {
      c += p.nominal;
      if (c >= goal.targetMin) {
        estimasiTercapai = p.tanggalMulai;
        break;
      }
    }
  }

  const minggu = [...new Set([...plans.map((p) => p.tanggalMulai), ...periods.map((p) => p.tanggalMulai)])]
    .filter((d) => d <= goal.tenggat)
    .sort();
  let rencanaKum = 0;
  let aktualKum = 0;
  const series: GoalPoint[] = minggu.map((m) => {
    rencanaKum += plans.find((p) => p.tanggalMulai === m)?.nominal ?? 0;
    const p = periods.find((x) => x.tanggalMulai === m);
    if (p) aktualKum += delta.get(p.id) ?? 0;
    const sudahLewat = m <= (period?.tanggalMulai ?? "");
    return { minggu: m, rencana: rencanaKum, aktual: sudahLewat || p ? aktualKum : null };
  });

  const status: GoalStatus = saldo >= goal.targetMin ? "tercapai" : proyeksi >= goal.targetIdeal ? "ideal" : proyeksi >= goal.targetMin ? "aman" : "kurang";

  return {
    goal,
    saldo,
    persenMin: Math.min(100, (saldo / goal.targetMin) * 100),
    hariLagi: diffDays(today, goal.tenggat),
    proyeksi,
    kurangDariMin: Math.max(0, goal.targetMin - proyeksi),
    estimasiTercapai,
    setoranTersisa: akanDatang.length,
    status,
    series,
  };
}

export async function updateGoal(db: Db, id: number, d: { nama: string; targetMin: number; targetIdeal: number; tenggat: string }) {
  if (!d.nama.trim()) throw new AppError("invalid", "Nama target wajib diisi.");
  if (!Number.isInteger(d.targetMin) || d.targetMin <= 0) throw new AppError("invalid", "Target minimal tidak valid.");
  if (!Number.isInteger(d.targetIdeal) || d.targetIdeal < d.targetMin) throw new AppError("invalid", "Target ideal harus ≥ target minimal.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.tenggat)) throw new AppError("invalid", "Tanggal tenggat tidak valid.");
  return db.goal.update({ where: { id }, data: { ...d, nama: d.nama.trim() } });
}
