import type { Db } from "../db";
import { planAllocation, type Alloc, type PlanResult } from "../allocation";
import { addDays, diffDays, sundayOnOrBefore, wibDate } from "../time";
import { AppError } from "./errors";
import { ENVELOPE_KODE, type EnvelopeKode } from "../types";
import { getBalances } from "./envelopes";

export type Period = NonNullable<Awaited<ReturnType<typeof getCurrentPeriod>>>;

/** Periode aktif terbaru (periode yang belum diganti oleh uang masuk berikutnya). */
export async function getCurrentPeriod(db: Db) {
  return db.period.findFirst({ where: { status: "aktif" }, orderBy: { tanggalMulai: "desc" } });
}

export async function getPendingPeriod(db: Db) {
  return db.period.findFirst({ where: { status: "menunggu" }, orderBy: { id: "desc" } });
}

/** Rencana pembagian yang berlaku untuk tanggal mulai tertentu (plan terbaru <= tanggal, else default amplop). */
export async function getPlanFor(db: Db, tanggalMulai: string): Promise<Alloc> {
  const envs = await db.envelope.findMany();
  const plan = Object.fromEntries(ENVELOPE_KODE.map((k) => [k, 0])) as Alloc;
  for (const e of envs) plan[e.kode as EnvelopeKode] = e.defaultNominal;

  const latest = await db.allocationPlan.findFirst({
    where: { tanggalMulai: { lte: tanggalMulai } },
    orderBy: { tanggalMulai: "desc" },
  });
  if (latest) {
    const rows = await db.allocationPlan.findMany({ where: { tanggalMulai: latest.tanggalMulai } });
    for (const r of rows) {
      const kode = envs.find((e) => e.id === r.envelopeId)?.kode as EnvelopeKode | undefined;
      if (kode) plan[kode] = r.nominal;
    }
  }
  return plan;
}

export async function hariKeTagihanBerikutnya(db: Db, hariIni: string): Promise<number | null> {
  const bill = await db.bill.findFirst({
    where: { status: "belum", jatuhTempo: { gte: hariIni } },
    orderBy: { jatuhTempo: "asc" },
  });
  return bill ? diffDays(hariIni, bill.jatuhTempo) : null;
}

export interface PeriodProposal {
  period: { id: number; tanggalMulai: string; tanggalSelesai: string; pemasukan: number };
  result: PlanResult;
}

/** Buat periode 'menunggu' + alokasi usulan. Periode lama yang belum dikonfirmasi dibuang. */
export async function proposePeriod(db: Db, income: number, now: Date): Promise<PeriodProposal> {
  if (!Number.isInteger(income) || income <= 0) throw new AppError("invalid", "Nominal uang masuk nggak valid.");
  const today = wibDate(now);
  const start = sundayOnOrBefore(today);
  const end = addDays(start, 6);

  const active = await getCurrentPeriod(db);
  if (active && active.tanggalMulai >= start) {
    throw new AppError("period_exists", "Periode minggu ini sudah jalan.");
  }

  const plan = await getPlanFor(db, start);
  const hariKeTagihan = await hariKeTagihanBerikutnya(db, today);
  const envs = await db.envelope.findMany();
  const urutan = envs
    .filter((e) => e.urutanPotong !== null)
    .sort((a, b) => a.urutanPotong! - b.urutanPotong!)
    .map((e) => e.kode as EnvelopeKode);
  const result = planAllocation({ income, plan, urutanPotong: urutan.length ? urutan : undefined, hariKeTagihan });

  await db.period.deleteMany({ where: { status: "menunggu" } });
  const period = await db.period.create({
    data: { tanggalMulai: start, tanggalSelesai: end, pemasukan: income, status: "menunggu" },
  });
  for (const e of envs) {
    const nominal = result.alloc[e.kode as EnvelopeKode] ?? 0;
    await db.allocation.create({ data: { periodId: period.id, envelopeId: e.id, nominal } });
  }
  return { period, result };
}

export async function getPeriodAllocations(db: Db, periodId: number): Promise<Alloc> {
  const rows = await db.allocation.findMany({ where: { periodId }, include: { envelope: true } });
  const out = Object.fromEntries(ENVELOPE_KODE.map((k) => [k, 0])) as Alloc;
  for (const r of rows) out[r.envelope.kode as EnvelopeKode] = r.nominal;
  return out;
}

/**
 * Konfirmasi periode: tutup periode aktif sebelumnya (sisa Makan pindah ke Darurat), lalu aktifkan yang baru.
 */
export async function confirmPeriod(db: Db, periodId: number, now: Date) {
  const period = await db.period.findUnique({ where: { id: periodId } });
  if (!period || period.status !== "menunggu") throw new AppError("not_found", "Periode tidak ditemukan.");

  const olds = await db.period.findMany({ where: { status: "aktif" } });
  const envs = await db.envelope.findMany();
  const makan = envs.find((e) => e.kode === "makan");
  const darurat = envs.find((e) => e.kode === "darurat");
  let sisaMakanPindah = 0;

  for (const old of olds) {
    if (makan && darurat) {
      const b = (await getBalances(db, old.id)).find((x) => x.kode === "makan");
      if (b && b.saldo > 0) {
        await db.transfer.create({
          data: {
            periodId: old.id,
            dariEnvelopeId: makan.id,
            keEnvelopeId: darurat.id,
            nominal: b.saldo,
            alasan: "Sisa Makan akhir minggu pindah ke Darurat",
          },
        });
        sisaMakanPindah += b.saldo;
      }
    }
    await db.period.update({ where: { id: old.id }, data: { status: "selesai" } });
  }

  const updated = await db.period.update({
    where: { id: periodId },
    data: { status: "aktif", dikonfirmasiPada: now },
  });
  return { period: updated, sisaMakanPindah };
}

export async function cancelPendingPeriod(db: Db, periodId: number) {
  await db.period.deleteMany({ where: { id: periodId, status: "menunggu" } });
}

/** Tambah uang ekstra (bonus) ke periode aktif pada amplop tertentu. */
export async function addBonus(db: Db, periodId: number, bagian: Partial<Record<EnvelopeKode, number>>) {
  const envs = await db.envelope.findMany();
  let total = 0;
  for (const [kode, nominal] of Object.entries(bagian) as [EnvelopeKode, number][]) {
    if (!nominal) continue;
    const env = envs.find((e) => e.kode === kode);
    if (!env) continue;
    await db.allocation.update({
      where: { periodId_envelopeId: { periodId, envelopeId: env.id } },
      data: { nominal: { increment: nominal } },
    });
    total += nominal;
  }
  await db.period.update({ where: { id: periodId }, data: { pemasukan: { increment: total } } });
  return total;
}

/** Sisa hari dalam periode termasuk hari ini. 0 kalau periode sudah lewat. */
export function hariSisaPeriode(period: { tanggalMulai: string; tanggalSelesai: string }, today: string): number {
  if (today > period.tanggalSelesai) return 0;
  const from = today < period.tanggalMulai ? period.tanggalMulai : today;
  return diffDays(from, period.tanggalSelesai) + 1;
}
