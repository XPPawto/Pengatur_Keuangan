import type { Db } from "../db";
import { planAllocation, type Alloc, type PlanResult } from "../allocation";
import { addDays, diffDays, sundayOnOrBefore, wibDate } from "../time";
import { AppError } from "./errors";
import { ENVELOPE_KODE, type EnvelopeKode } from "../types";
import { getBalances } from "./envelopes";
import { logActivity, type Actor } from "./activity-log";
import { rp } from "../money";

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
 * Konfirmasi periode: tutup periode aktif sebelumnya (sisa Makan & Paket data pindah ke Darurat), lalu aktifkan yang baru.
 */
export async function confirmPeriod(db: Db, periodId: number, now: Date, actor: Actor = { oleh: "web", sumber: "web" }) {
  const period = await db.period.findUnique({ where: { id: periodId } });
  if (!period || period.status !== "menunggu") throw new AppError("not_found", "Periode tidak ditemukan.");

  const olds = await db.period.findMany({ where: { status: "aktif" } });
  const envs = await db.envelope.findMany();
  const darurat = envs.find((e) => e.kode === "darurat");
  let sisaMakanPindah = 0;
  let sisaDataPindah = 0;
  const transferIds: number[] = [];

  for (const old of olds) {
    if (darurat) {
      const balances = await getBalances(db, old.id);
      for (const kode of ["makan", "data"] as const) {
        const env = envs.find((e) => e.kode === kode);
        const b = balances.find((x) => x.kode === kode);
        if (!env || !b || b.saldo <= 0) continue;
        const tr = await db.transfer.create({
          data: {
            periodId: old.id,
            dariEnvelopeId: env.id,
            keEnvelopeId: darurat.id,
            nominal: b.saldo,
            alasan: `Sisa ${env.nama} akhir minggu pindah ke Darurat`,
            dibuatPada: now,
          },
        });
        transferIds.push(tr.id);
        if (kode === "makan") sisaMakanPindah += b.saldo;
        else sisaDataPindah += b.saldo;
      }
    }
    await db.period.update({ where: { id: old.id }, data: { status: "selesai" } });
  }

  const updated = await db.period.update({
    where: { id: periodId },
    data: { status: "aktif", dikonfirmasiPada: now },
  });
  await logActivity(db, actor, "uang_masuk", `Uang mingguan ${rp(updated.pemasukan)} dikonfirmasi (periode ${updated.tanggalMulai})`, {
    undo: { t: "batal_periode", periodId, transferIds, periodeLamaIds: olds.map((o) => o.id) },
    now,
  });
  return { period: updated, sisaMakanPindah, sisaDataPindah };
}

export async function cancelPendingPeriod(db: Db, periodId: number) {
  await db.period.deleteMany({ where: { id: periodId, status: "menunggu" } });
}

/** Tambah uang ke periode (uang ekstra, kiriman, piutang kembali) pada amplop tertentu; dicatat di kolom `tambahan`. */
export async function addBonus(
  db: Db,
  periodId: number,
  bagian: Partial<Record<EnvelopeKode, number>>,
  log?: { actor: Actor; ringkasan: string; now: Date; aksi?: string },
) {
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
  await db.period.update({ where: { id: periodId }, data: { tambahan: { increment: total } } });
  if (log) {
    await logActivity(db, log.actor, log.aksi ?? "uang_ekstra", log.ringkasan, {
      undo: { t: "kurangi_alokasi", periodId, bagian: bagian as Record<string, number> },
      now: log.now,
    });
  }
  return total;
}

/**
 * Koreksi nominal uang mingguan yang sudah dikonfirmasi (mis. salah ketik `masuk 30`).
 * Selisihnya masuk/keluar dari amplop Darurat (amplop sisa), amplop lain tidak berubah.
 */
export async function setPemasukan(db: Db, periodId: number, nominal: number, now: Date, actor: Actor = { oleh: "web", sumber: "web" }) {
  if (!Number.isInteger(nominal) || nominal <= 0) throw new AppError("invalid", "Nominal pemasukan tidak valid.");
  const period = await db.period.findUnique({ where: { id: periodId } });
  if (!period) throw new AppError("not_found", "Periode tidak ditemukan.");
  const alokasiSebelum = await getPeriodAllocations(db, periodId);
  const selisih = nominal - period.pemasukan;
  if (selisih === 0) return { selisih: 0 };
  const darurat = await db.envelope.findUniqueOrThrow({ where: { kode: "darurat" } });
  await db.allocation.update({
    where: { periodId_envelopeId: { periodId, envelopeId: darurat.id } },
    data: { nominal: Math.max(0, alokasiSebelum.darurat + selisih) },
  });
  await db.period.update({ where: { id: periodId }, data: { pemasukan: nominal } });
  await logActivity(db, actor, "koreksi_pemasukan", `Koreksi uang mingguan ${rp(period.pemasukan)} → ${rp(nominal)} (selisih lewat Darurat)`, {
    undo: { t: "pemasukan", periodId, pemasukanSebelum: period.pemasukan, alokasiSebelum },
    now,
  });
  return { selisih };
}

/** Sisa hari dalam periode termasuk hari ini. 0 kalau periode sudah lewat. */
export function hariSisaPeriode(period: { tanggalMulai: string; tanggalSelesai: string }, today: string): number {
  if (today > period.tanggalSelesai) return 0;
  const from = today < period.tanggalMulai ? period.tanggalMulai : today;
  return diffDays(from, period.tanggalSelesai) + 1;
}

/** Ubah alokasi satu amplop di periode tertentu (koreksi manual dari website). */
export async function setAllocation(db: Db, periodId: number, kode: EnvelopeKode, nominal: number) {
  if (!Number.isInteger(nominal) || nominal < 0) throw new AppError("invalid", "Nominal alokasi tidak valid.");
  const env = await db.envelope.findUnique({ where: { kode } });
  if (!env) throw new AppError("not_found", "Amplop tidak ditemukan.");
  await db.allocation.upsert({
    where: { periodId_envelopeId: { periodId, envelopeId: env.id } },
    update: { nominal },
    create: { periodId, envelopeId: env.id, nominal },
  });
  const all = await db.allocation.findMany({ where: { periodId } });
  const period = await db.period.findUniqueOrThrow({ where: { id: periodId } });
  return { totalAlokasi: all.reduce((s, a) => s + a.nominal, 0), pemasukan: period.pemasukan + period.tambahan };
}

export async function listPlans(db: Db) {
  const rows = await db.allocationPlan.findMany({ include: { envelope: true }, orderBy: { tanggalMulai: "asc" } });
  const byDate = new Map<string, Alloc>();
  for (const r of rows) {
    const a = byDate.get(r.tanggalMulai) ?? (Object.fromEntries(ENVELOPE_KODE.map((k) => [k, 0])) as Alloc);
    a[r.envelope.kode as EnvelopeKode] = r.nominal;
    byDate.set(r.tanggalMulai, a);
  }
  return [...byDate.entries()].map(([tanggalMulai, alloc]) => ({ tanggalMulai, alloc }));
}

export async function setPlan(db: Db, tanggalMulai: string, alloc: Partial<Alloc>) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggalMulai)) throw new AppError("invalid", "Tanggal tidak valid.");
  const envs = await db.envelope.findMany();
  for (const [kode, nominal] of Object.entries(alloc) as [EnvelopeKode, number][]) {
    const env = envs.find((e) => e.kode === kode);
    if (!env || !Number.isInteger(nominal) || nominal < 0) continue;
    await db.allocationPlan.upsert({
      where: { tanggalMulai_envelopeId: { tanggalMulai, envelopeId: env.id } },
      update: { nominal },
      create: { tanggalMulai, envelopeId: env.id, nominal },
    });
  }
}
