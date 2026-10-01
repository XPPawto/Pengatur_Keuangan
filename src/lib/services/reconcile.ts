import type { Db } from "../db";
import { rp } from "../money";
import type { EnvelopeKode } from "../types";
import { logActivity, type Actor } from "./activity-log";
import { AppError } from "./errors";
import { addBonus, getCurrentPeriod } from "./periods";
import { recordExpense } from "./transactions";

/**
 * Uang yang seharusnya ada di tangan menurut sistem:
 * semua pemasukan periode yang sudah dikonfirmasi − semua pengeluaran. (Pindah amplop tidak mengubah total.)
 */
export async function saldoSistem(db: Db): Promise<number> {
  const [masuk, keluar] = await Promise.all([
    db.period.aggregate({ _sum: { pemasukan: true, tambahan: true }, where: { status: { not: "menunggu" } } }),
    db.transaction.aggregate({ _sum: { nominal: true }, where: { period: { status: { not: "menunggu" } } } }),
  ]);
  return (masuk._sum.pemasukan ?? 0) + (masuk._sum.tambahan ?? 0) - (keluar._sum.nominal ?? 0);
}

/** Mulai pencocokan: bandingkan uang asli (dompet + e-wallet) dengan catatan sistem. */
export async function mulaiRekonsiliasi(db: Db, saldoAsli: number, actor: Actor, now: Date) {
  if (!Number.isInteger(saldoAsli) || saldoAsli < 0) throw new AppError("invalid", "Nominal saldo asli tidak valid.");
  if (!(await getCurrentPeriod(db))) throw new AppError("no_period", "Belum ada periode aktif.");
  const sistem = await saldoSistem(db);
  const selisih = saldoAsli - sistem;
  const rec = await db.reconciliation.create({
    data: { waktu: now, oleh: actor.oleh, saldoSistem: sistem, saldoAsli, selisih, tindakan: selisih === 0 ? "cocok" : "" },
  });
  return rec;
}

export type TindakanRekon = { catatKe: EnvelopeKode } | "uang_ekstra" | "abaikan";

/** Selesaikan selisih: catat sebagai pengeluaran yang terlewat, tambah sebagai uang ekstra, atau abaikan. */
export async function selesaikanRekonsiliasi(db: Db, id: number, tindakan: TindakanRekon, actor: Actor, now: Date) {
  const rec = await db.reconciliation.findUnique({ where: { id } });
  if (!rec) throw new AppError("not_found", "Data rekonsiliasi tidak ditemukan.");
  if (rec.tindakan) throw new AppError("invalid", "Rekonsiliasi ini sudah diselesaikan.");
  const period = await getCurrentPeriod(db);
  if (!period) throw new AppError("no_period", "Belum ada periode aktif.");

  if (tindakan === "abaikan") {
    await db.reconciliation.update({ where: { id }, data: { tindakan: "diabaikan" } });
    await logActivity(db, actor, "rekonsiliasi", `Selisih ${rp(rec.selisih)} diabaikan`, { now });
    return "diabaikan";
  }
  if (tindakan === "uang_ekstra") {
    if (rec.selisih <= 0) throw new AppError("invalid", "Uang asli lebih sedikit, jadi bukan uang ekstra.");
    await addBonus(db, period.id, { darurat: rec.selisih }, { actor, now, aksi: "rekonsiliasi", ringkasan: `Rekonsiliasi: uang lebih ${rp(rec.selisih)} masuk Darurat` });
    await db.reconciliation.update({ where: { id }, data: { tindakan: "uang_ekstra" } });
    return "uang_ekstra";
  }
  if (rec.selisih >= 0) throw new AppError("invalid", "Tidak ada pengeluaran yang terlewat.");
  await recordExpense(db, {
    kode: tindakan.catatKe,
    nominal: -rec.selisih,
    catatan: "Selisih rekonsiliasi (pengeluaran tidak tercatat)",
    sumber: actor.sumber === "wa" ? "wa" : "web",
    now,
    jenis: "koreksi",
    actor,
  });
  await db.reconciliation.update({ where: { id }, data: { tindakan: "dicatat" } });
  return "dicatat";
}

export async function riwayatRekonsiliasi(db: Db, take = 10) {
  return db.reconciliation.findMany({ orderBy: { waktu: "desc" }, take });
}
