import type { Db } from "../db";
import { diffDays, wibDate } from "../time";
import type { EnvelopeKode, Sumber } from "../types";
import { AppError } from "./errors";
import { getBalances } from "./envelopes";
import { getCurrentPeriod } from "./periods";
import { recordExpense } from "./transactions";
import { logActivity, type Actor } from "./activity-log";
import { rp } from "../money";

export async function listBills(db: Db) {
  return db.bill.findMany({ include: { envelope: true }, orderBy: [{ status: "asc" }, { jatuhTempo: "asc" }] });
}

export async function unpaidBills(db: Db) {
  return db.bill.findMany({ where: { status: "belum" }, include: { envelope: true }, orderBy: { jatuhTempo: "asc" } });
}

/**
 * Tagihan paylater yang dimaksud: kalau nominal disebut dan ada yang persis sama, itu; kalau tidak,
 * yang terdekat dari amplop Paylater (tagihan "di luar sistem" hanya jadi cadangan terakhir).
 */
export async function nextPaylaterBill(db: Db, nominal?: number | null) {
  const list = await db.bill.findMany({
    where: { status: "belum", OR: [{ envelope: { kode: "paylater" } }, { nama: { contains: "aylater" } }] },
    include: { envelope: true },
    orderBy: { jatuhTempo: "asc" },
  });
  if (nominal) {
    const sama = list.find((b) => b.nominal === nominal);
    if (sama) return sama;
  }
  return list.find((b) => b.envelope?.kode === "paylater") ?? list[0] ?? null;
}

export interface BillInput {
  nama: string;
  nominal: number;
  jatuhTempo: string;
  tanggalPasti?: boolean;
  envelopeKode?: EnvelopeKode | null;
  catatan?: string;
}

function validasi(b: BillInput) {
  if (!b.nama.trim()) throw new AppError("invalid", "Nama tagihan wajib diisi.");
  if (!Number.isInteger(b.nominal) || b.nominal <= 0) throw new AppError("invalid", "Nominal tagihan harus lebih dari 0.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.jatuhTempo)) throw new AppError("invalid", "Tanggal jatuh tempo tidak valid.");
}

async function envelopeId(db: Db, kode?: EnvelopeKode | null) {
  if (!kode) return null;
  const e = await db.envelope.findUnique({ where: { kode } });
  return e?.id ?? null;
}

export async function createBill(db: Db, b: BillInput) {
  validasi(b);
  return db.bill.create({
    data: {
      nama: b.nama.trim(),
      nominal: b.nominal,
      jatuhTempo: b.jatuhTempo,
      tanggalPasti: b.tanggalPasti ?? true,
      envelopeId: await envelopeId(db, b.envelopeKode),
      catatan: b.catatan?.trim() ?? "",
    },
  });
}

export async function updateBill(db: Db, id: number, b: BillInput) {
  validasi(b);
  return db.bill.update({
    where: { id },
    data: {
      nama: b.nama.trim(),
      nominal: b.nominal,
      jatuhTempo: b.jatuhTempo,
      tanggalPasti: b.tanggalPasti ?? true,
      envelopeId: await envelopeId(db, b.envelopeKode),
      catatan: b.catatan?.trim() ?? "",
    },
  });
}

export async function deleteBill(db: Db, id: number) {
  await db.bill.delete({ where: { id } });
}

export interface PayResult {
  bill: { id: number; nama: string; nominal: number; jatuhTempo: string };
  dibayar: number;
  /** saldo amplop sumber setelah bayar (null kalau tagihan di luar sistem) */
  saldoSetelah: number | null;
  terlambatHari: number;
}

/**
 * Bayar tagihan: catat pengeluaran dari amplop sumber (kalau ada) lalu tandai lunas.
 * Nominal boleh beda dari perkiraan; nominal tagihan diperbarui ke angka aslinya.
 */
export async function payBill(db: Db, id: number, opts: { nominal?: number; now: Date; sumber: Sumber; pesanAsli?: string; actor?: Actor }): Promise<PayResult> {
  const bill = await db.bill.findUnique({ where: { id }, include: { envelope: true } });
  if (!bill) throw new AppError("not_found", "Tagihan tidak ditemukan.");
  if (bill.status === "lunas") throw new AppError("invalid", `${bill.nama} ${bill.jatuhTempo} sudah lunas.`);
  const nominal = opts.nominal ?? bill.nominal;

  let saldoSetelah: number | null = null;
  let txId: number | null = null;
  if (bill.envelope) {
    const r = await recordExpense(db, {
      kode: bill.envelope.kode as EnvelopeKode,
      nominal,
      catatan: `Bayar ${bill.nama}`,
      sumber: opts.sumber,
      pesanAsli: opts.pesanAsli,
      now: opts.now,
      billId: bill.id,
      log: false,
    });
    saldoSetelah = r.balance.saldo;
    txId = r.id;
  }
  await db.bill.update({ where: { id }, data: { status: "lunas", dibayarPada: opts.now, nominal } });
  await logActivity(db, opts.actor ?? { oleh: opts.sumber, sumber: opts.sumber }, "bayar_tagihan", `Bayar ${bill.nama} ${bill.jatuhTempo} ${rp(nominal)}`, {
    undo: { t: "batal_bayar", billId: bill.id, txId, nominalSebelum: bill.nominal },
    now: opts.now,
  });
  return {
    bill: { id: bill.id, nama: bill.nama, nominal, jatuhTempo: bill.jatuhTempo },
    dibayar: nominal,
    saldoSetelah,
    terlambatHari: Math.max(0, diffDays(bill.jatuhTempo, wibDate(opts.now))),
  };
}

/** Batalkan status lunas; transaksi pembayarannya (kalau ada) ikut dihapus supaya saldo kembali. */
export async function markBillUnpaid(db: Db, id: number, now = new Date(), actor: Actor = { oleh: "web", sumber: "web" }) {
  const bill = await db.bill.findUnique({ where: { id } });
  if (!bill) throw new AppError("not_found", "Tagihan tidak ditemukan.");
  const txs = await db.transaction.findMany({ where: { billId: id } });
  await db.transaction.deleteMany({ where: { billId: id } });
  await db.bill.update({ where: { id }, data: { status: "belum", dibayarPada: null } });
  await logActivity(db, actor, "batal_lunas", `Batalkan lunas ${bill.nama} ${bill.jatuhTempo}${txs.length ? ` (pembayaran ${rp(txs.reduce((a, t) => a + t.nominal, 0))} dihapus)` : ""}`, { now });
}

/** Tagihan dengan kesiapan dana: saldo amplop sumber cukup atau kurang. */
export async function billsWithReadiness(db: Db, now: Date) {
  const period = await getCurrentPeriod(db);
  const balances = await getBalances(db, period?.id ?? null);
  const today = wibDate(now);
  const bills = await listBills(db);
  // Kesiapan dihitung bertahap: tagihan terdekat memakai saldo amplop duluan, berikutnya memakai sisanya.
  const sisa = new Map<number, number>();
  for (const b of balances) sisa.set(b.id, b.saldo);
  const urut = [...bills].sort((a, b) => a.jatuhTempo.localeCompare(b.jatuhTempo));
  const info = new Map<number, { saldoSumber: number | null; cukup: boolean | null }>();
  for (const b of urut) {
    if (b.status !== "belum" || !b.envelopeId) {
      info.set(b.id, { saldoSumber: null, cukup: null });
      continue;
    }
    const tersedia = Math.max(0, sisa.get(b.envelopeId) ?? 0);
    info.set(b.id, { saldoSumber: tersedia, cukup: tersedia >= b.nominal });
    sisa.set(b.envelopeId, tersedia - b.nominal);
  }
  return bills.map((b) => ({ ...b, hariLagi: diffDays(today, b.jatuhTempo), ...info.get(b.id)! }));
}
