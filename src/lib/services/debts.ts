import type { Db } from "../db";
import { rp } from "../money";
import { detectCategory } from "../parser/category";
import type { EnvelopeKode } from "../types";
import { logActivity, type Actor } from "./activity-log";
import { AppError } from "./errors";
import { addBonus, getCurrentPeriod } from "./periods";
import { recordExpense } from "./transactions";

export type Arah = "piutang" | "hutang";

export function rapikanNama(nama: string): string {
  const s = nama.trim().replace(/\s+/g, " ");
  return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s;
}

async function sisaDebt(db: Db, debtId: number, nominal: number) {
  const agg = await db.debtPayment.aggregate({ _sum: { nominal: true }, where: { debtId } });
  return nominal - (agg._sum.nominal ?? 0);
}

/**
 * Catat hutang-piutang. Uangnya ikut bergerak supaya saldo tetap cocok dengan dompet:
 * - piutang (kita meminjamkan): uang keluar dari amplop sumber (default Darurat)
 * - hutang (kita meminjam): uang masuk ke amplop (default Darurat)
 */
export async function createDebt(
  db: Db,
  d: { orang: string; arah: Arah; nominal: number; catatan?: string; envelopeKode?: EnvelopeKode; actor: Actor; now: Date },
) {
  if (!d.orang.trim()) throw new AppError("invalid", "Nama orangnya siapa?");
  if (!Number.isInteger(d.nominal) || d.nominal <= 0) throw new AppError("invalid", "Nominal tidak valid.");
  const period = await getCurrentPeriod(db);
  if (!period) throw new AppError("no_period", "Belum ada periode aktif.");
  const orang = rapikanNama(d.orang);
  const kode = d.envelopeKode ?? "darurat";
  const debt = await db.debt.create({
    data: { orang, arah: d.arah, nominal: d.nominal, catatan: d.catatan ?? "", envelopeKode: kode, dibuatPada: d.now },
  });
  const txIds: number[] = [];
  let bagian: Record<string, number> = {};
  if (d.arah === "piutang") {
    const r = await recordExpense(db, { kode, nominal: d.nominal, catatan: `Dipinjamkan ke ${orang}`, sumber: d.actor.sumber === "wa" ? "wa" : "web", now: d.now, debtId: debt.id, log: false });
    txIds.push(r.id);
  } else {
    bagian = { [kode]: d.nominal };
    await addBonus(db, period.id, bagian);
  }
  await logActivity(db, d.actor, "hutang", d.arah === "piutang" ? `${orang} pinjam ${rp(d.nominal)}` : `Pinjam ke ${orang} ${rp(d.nominal)}`, {
    undo: { t: "batal_debt", debtId: debt.id, txIds, periodId: d.arah === "hutang" ? period.id : null, bagian },
    now: d.now,
  });
  return debt;
}

/** Catat pembayaran hutang-piutang (sebagian atau lunas). Tanpa nominal = lunasi sisa. */
export async function bayarDebt(db: Db, d: { orang: string; arah: Arah; nominal?: number | null; actor: Actor; now: Date }) {
  const orang = rapikanNama(d.orang);
  const period = await getCurrentPeriod(db);
  if (!period) throw new AppError("no_period", "Belum ada periode aktif.");
  const aktif = await db.debt.findMany({ where: { orang, arah: d.arah, status: "aktif" }, orderBy: { dibuatPada: "asc" } });
  if (!aktif.length) throw new AppError("not_found", d.arah === "piutang" ? `${orang} nggak punya utang ke lo.` : `Lo nggak punya utang ke ${orang}.`);
  const debt = aktif[0];
  const sisa = await sisaDebt(db, debt.id, debt.nominal);
  const nominal = d.nominal ?? sisa;
  if (nominal <= 0) throw new AppError("invalid", "Nominal tidak valid.");
  if (nominal > sisa) throw new AppError("invalid", `Sisa ${d.arah === "piutang" ? `utang ${orang}` : `utang ke ${orang}`} cuma ${rp(sisa)}.`);

  const pay = await db.debtPayment.create({ data: { debtId: debt.id, nominal, waktu: d.now } });
  const txIds: number[] = [];
  let bagian: Record<string, number> = {};
  if (d.arah === "piutang") {
    bagian = { [debt.envelopeKode]: nominal };
    await addBonus(db, period.id, bagian);
  } else {
    const r = await recordExpense(db, { kode: debt.envelopeKode as EnvelopeKode, nominal, catatan: `Bayar utang ke ${orang}`, sumber: d.actor.sumber === "wa" ? "wa" : "web", now: d.now, debtId: debt.id, log: false });
    txIds.push(r.id);
  }
  const lunas = nominal === sisa;
  if (lunas) await db.debt.update({ where: { id: debt.id }, data: { status: "lunas", lunasPada: d.now } });
  await logActivity(db, d.actor, "bayar_hutang", d.arah === "piutang" ? `${orang} bayar ${rp(nominal)}${lunas ? " (lunas)" : ""}` : `Bayar utang ke ${orang} ${rp(nominal)}${lunas ? " (lunas)" : ""}`, {
    undo: { t: "batal_debt_bayar", paymentId: pay.id, debtId: debt.id, txIds, periodId: d.arah === "piutang" ? period.id : null, bagian, statusSebelum: "aktif" },
    now: d.now,
  });
  return { debt, dibayar: nominal, sisa: sisa - nominal, lunas };
}

export interface DebtRow {
  id: number;
  orang: string;
  arah: Arah;
  nominal: number;
  sisa: number;
  catatan: string;
  dibuatPada: Date;
  status: string;
  umurHari: number;
}

export async function listDebts(db: Db, now: Date, opts: { aktifSaja?: boolean } = {}): Promise<DebtRow[]> {
  const rows = await db.debt.findMany({
    where: opts.aktifSaja ? { status: "aktif" } : undefined,
    include: { payments: true },
    orderBy: [{ status: "asc" }, { dibuatPada: "desc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    orang: r.orang,
    arah: r.arah as Arah,
    nominal: r.nominal,
    sisa: r.nominal - r.payments.reduce((a, p) => a + p.nominal, 0),
    catatan: r.catatan,
    dibuatPada: r.dibuatPada,
    status: r.status,
    umurHari: Math.floor((now.getTime() - r.dibuatPada.getTime()) / 86400_000),
  }));
}

export async function ringkasanDebt(db: Db, now: Date) {
  const rows = await listDebts(db, now, { aktifSaja: true });
  return {
    piutang: rows.filter((r) => r.arah === "piutang").reduce((a, r) => a + r.sisa, 0),
    hutang: rows.filter((r) => r.arah === "hutang").reduce((a, r) => a + r.sisa, 0),
    rows,
  };
}

/**
 * Patungan: lo bayar duluan total belanja, dibagi rata dengan teman yang disebut.
 * Bagian lo dicatat sebagai pengeluaran biasa; bagian teman jadi piutang.
 */
export async function patungan(db: Db, p: { barang: string; total: number; orang: string[]; actor: Actor; now: Date; kode?: EnvelopeKode }) {
  if (!p.orang.length) throw new AppError("invalid", "Sebut nama temannya, mis. `patungan galon 18k sama budi andi`.");
  if (!Number.isInteger(p.total) || p.total <= 0) throw new AppError("invalid", "Nominal tidak valid.");
  const period = await getCurrentPeriod(db);
  if (!period) throw new AppError("no_period", "Belum ada periode aktif.");
  const kode = p.kode ?? detectCategory(p.barang) ?? "darurat";
  const n = p.orang.length + 1;
  const bagianTeman = Math.floor(p.total / n / 100) * 100;
  const bagianSendiri = p.total - bagianTeman * p.orang.length;
  const sumber = p.actor.sumber === "wa" ? "wa" : "web";
  const txIds: number[] = [];
  const debtIds: number[] = [];

  const mine = await recordExpense(db, { kode, nominal: bagianSendiri, catatan: `${p.barang} (patungan)`, sumber, now: p.now, log: false });
  txIds.push(mine.id);
  for (const nama of p.orang.map(rapikanNama)) {
    const debt = await db.debt.create({ data: { orang: nama, arah: "piutang", nominal: bagianTeman, catatan: `Patungan ${p.barang}`, envelopeKode: kode, dibuatPada: p.now } });
    debtIds.push(debt.id);
    const r = await recordExpense(db, { kode, nominal: bagianTeman, catatan: `Talangin ${nama} (patungan ${p.barang})`, sumber, now: p.now, debtId: debt.id, log: false });
    txIds.push(r.id);
  }
  await logActivity(db, p.actor, "patungan", `Patungan ${p.barang} ${rp(p.total)}: lo ${rp(bagianSendiri)}, ${p.orang.map(rapikanNama).join(", ")} masing-masing ${rp(bagianTeman)}`, {
    undo: { t: "batal_patungan", txIds, debtIds },
    now: p.now,
  });
  return { kode, bagianSendiri, bagianTeman, orang: p.orang.map(rapikanNama) };
}
