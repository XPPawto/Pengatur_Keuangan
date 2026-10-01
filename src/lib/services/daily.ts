import type { Db } from "../db";
import { jatahHarian } from "../money";
import { addDays, wibDate } from "../time";
import { getBalances } from "./envelopes";
import { getCurrentPeriod, hariSisaPeriode } from "./periods";
import { logActivity, type Actor } from "./activity-log";

export interface DailyStatus {
  periodId: number;
  tanggalMulai: string;
  tanggalSelesai: string;
  hariIni: string;
  /** hari tersisa termasuk hari ini; 0 = periode sudah lewat */
  hariSisa: number;
  saldoMakan: number;
  makanHariIni: number;
  /** jatah hari ini: (saldo + yang sudah dipakai hari ini) / sisa hari. Stabil sepanjang hari. */
  jatahHariIni: number;
  /** sisa jatah hari ini (negatif = lewat) */
  sisaJatahHariIni: number;
  /** jatah rata-rata per hari untuk hari-hari berikutnya, dari saldo sekarang */
  jatahBesok: number;
  /** Rata-rata per hari dari saldo sekarang (sisa / sisa hari) */
  rataSekarang: number;
}

export async function getDailyStatus(db: Db, now: Date): Promise<DailyStatus | null> {
  const period = await getCurrentPeriod(db);
  if (!period) return null;
  const hariIni = wibDate(now);
  const hariSisa = hariSisaPeriode(period, hariIni);
  const balances = await getBalances(db, period.id);
  const saldoMakan = balances.find((b) => b.kode === "makan")?.saldo ?? 0;
  const makanEnv = await db.envelope.findUnique({ where: { kode: "makan" } });
  const agg = await db.transaction.aggregate({
    _sum: { nominal: true },
    where: { periodId: period.id, envelopeId: makanEnv?.id ?? -1, tanggal: hariIni },
  });
  const makanHariIni = agg._sum.nominal ?? 0;
  const jatahHariIni = jatahHarian(saldoMakan + makanHariIni, hariSisa);
  return {
    periodId: period.id,
    tanggalMulai: period.tanggalMulai,
    tanggalSelesai: period.tanggalSelesai,
    hariIni,
    hariSisa,
    saldoMakan,
    makanHariIni,
    jatahHariIni,
    sisaJatahHariIni: jatahHariIni - makanHariIni,
    jatahBesok: hariSisa > 1 ? jatahHarian(saldoMakan, hariSisa - 1) : 0,
    rataSekarang: jatahHarian(saldoMakan, hariSisa),
  };
}

/** Sinkronkan catatan harian (dipakai untuk streak & rekap) dari transaksi di tanggal itu. */
export async function syncDailyLog(db: Db, tanggal: string, now: Date, opts: { tanpaJajan?: boolean } = {}) {
  const makanEnv = await db.envelope.findUnique({ where: { kode: "makan" } });
  const [count, makan] = await Promise.all([
    db.transaction.count({ where: { tanggal } }),
    db.transaction.aggregate({ _sum: { nominal: true }, where: { tanggal, envelopeId: makanEnv?.id ?? -1 } }),
  ]);
  const existing = await db.dailyLog.findUnique({ where: { tanggal } });
  const tanpaJajan = opts.tanpaJajan ?? existing?.tanpaJajan ?? false;
  const status = tanggal === wibDate(now) ? await getDailyStatus(db, now) : null;
  const data = {
    adaCatatan: count > 0,
    tanpaJajan,
    totalMakan: makan._sum.nominal ?? 0,
    jatahHariItu: status?.jatahHariIni ?? existing?.jatahHariItu ?? 0,
  };
  await db.dailyLog.upsert({ where: { tanggal }, create: { tanggal, ...data }, update: data });
}

export async function markTanpaJajan(db: Db, now: Date, actor: Actor = { oleh: "web", sumber: "web" }) {
  const tanggal = wibDate(now);
  const sebelum = (await db.dailyLog.findUnique({ where: { tanggal } }))?.tanpaJajan ?? false;
  await syncDailyLog(db, tanggal, now, { tanpaJajan: true });
  if (!sebelum) {
    await logActivity(db, actor, "tanpa_jajan", `Tandai ${tanggal} tanpa jajan`, { undo: { t: "tanpa_jajan_off", tanggal, sebelum }, now });
  }
  return tanggal;
}

/** Streak: hari berturut-turut (sampai hari ini, atau kemarin kalau hari ini belum dicatat) dengan catatan atau "nol". */
export async function getStreak(db: Db, now: Date): Promise<number> {
  const logs = await db.dailyLog.findMany({ where: { OR: [{ adaCatatan: true }, { tanpaJajan: true }] } });
  const ok = new Set(logs.map((l) => l.tanggal));
  let day = wibDate(now);
  if (!ok.has(day)) day = addDays(day, -1);
  let n = 0;
  while (ok.has(day)) {
    n++;
    day = addDays(day, -1);
  }
  return n;
}
