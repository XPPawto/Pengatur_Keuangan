import type { Db } from "../db";
import type { EnvelopeKode, Sumber } from "../types";
import { AppError } from "./errors";
import { getDailyStatus } from "./daily";
import { getBalances } from "./envelopes";
import { getCurrentPeriod } from "./periods";
import { recordExpense } from "./transactions";
import { logActivity, type Actor } from "./activity-log";
import { rp } from "../money";

const TUNDA_MS = 24 * 3600_000;

export interface PurchaseImpact {
  nominal: number;
  /** setara berapa hari jatah makan */
  hariMakan: number;
  rataJatah: number;
  saldoSumber: number;
  sisaSumber: number;
  /** kalau Darurat nggak cukup, kekurangannya bakal "makan" tabungan kado */
  kadoMundur: number;
}

export async function analyzePurchase(db: Db, nominal: number, now: Date, kode: EnvelopeKode = "darurat"): Promise<PurchaseImpact> {
  const period = await getCurrentPeriod(db);
  const [daily, balances] = await Promise.all([getDailyStatus(db, now), getBalances(db, period?.id ?? null)]);
  const rata = Math.max(daily?.jatahHariIni || daily?.rataSekarang || 12000, 1000);
  const saldo = balances.find((b) => b.kode === kode)?.saldo ?? 0;
  return {
    nominal,
    hariMakan: Math.round((nominal / rata) * 10) / 10,
    rataJatah: rata,
    saldoSumber: saldo,
    sisaSumber: saldo - nominal,
    kadoMundur: Math.max(0, nominal - Math.max(0, saldo)),
  };
}

export async function createHold(db: Db, h: { barang: string; nominal: number; envelopeKode?: EnvelopeKode; nomor?: string | null; now: Date }) {
  if (!Number.isInteger(h.nominal) || h.nominal <= 0) throw new AppError("invalid", "Nominal harus lebih dari 0.");
  return db.holdRequest.create({
    data: {
      barang: h.barang.trim() || "barang",
      nominal: h.nominal,
      envelopeKode: h.envelopeKode ?? "darurat",
      nomor: h.nomor ?? null,
      dibuatPada: h.now,
      tanyaUlangPada: new Date(h.now.getTime() + TUNDA_MS),
    },
  });
}

/** Putuskan hasil tahan belanja. "beli" mencatat pengeluaran; "batal" dihitung sebagai uang yang diselamatkan. */
export async function decideHold(db: Db, id: number, keputusan: "beli" | "batal", now: Date, sumber: Sumber, actor?: Actor) {
  const h = await db.holdRequest.findUnique({ where: { id } });
  if (!h) throw new AppError("not_found", "Catatan tahan belanja tidak ditemukan.");
  if (h.hasil !== "menunggu") throw new AppError("invalid", `Udah diputuskan: ${h.hasil}.`);
  let saldoSetelah: number | null = null;
  let txId: number | null = null;
  if (keputusan === "beli") {
    const r = await recordExpense(db, { kode: h.envelopeKode as EnvelopeKode, nominal: h.nominal, catatan: h.barang, sumber, now, log: false });
    saldoSetelah = r.balance.saldo;
    txId = r.id;
  }
  const updated = await db.holdRequest.update({ where: { id }, data: { hasil: keputusan, diputuskanPada: now } });
  await logActivity(db, actor ?? { oleh: sumber, sumber }, "tahan_belanja", keputusan === "beli" ? `Jadi beli ${h.barang} ${rp(h.nominal)}` : `Tidak jadi beli ${h.barang}, ${rp(h.nominal)} diselamatkan`, {
    undo: { t: "hold_menunggu", holdId: id, txId },
    now,
  });
  return { hold: updated, saldoSetelah };
}

/** Tahan belanja yang sudah ditanyakan ulang dan masih menunggu jawaban, paling baru dulu. */
export async function latestAskedHold(db: Db) {
  return db.holdRequest.findFirst({ where: { hasil: "menunggu", sudahDitanya: true }, orderBy: { tanyaUlangPada: "desc" } });
}

export async function listHolds(db: Db, take = 50) {
  return db.holdRequest.findMany({ orderBy: { dibuatPada: "desc" }, take });
}

export async function savedTotal(db: Db, range?: { dari: Date; sampai: Date }) {
  const agg = await db.holdRequest.aggregate({
    _sum: { nominal: true },
    _count: true,
    where: { hasil: "batal", diputuskanPada: range ? { gte: range.dari, lt: range.sampai } : undefined },
  });
  return { total: agg._sum.nominal ?? 0, jumlah: agg._count };
}
