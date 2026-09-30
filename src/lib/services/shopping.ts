import type { Db } from "../db";
import { diffDays, sundayOnOrBefore, weekdayOf, wibDate } from "../time";
import { AppError } from "./errors";
import { getCurrentPeriod, getPeriodAllocations, getPlanFor } from "./periods";

/** Minggu pertama siklus lauk rotasi. */
export const AWAL_ROTASI = "2026-10-04";

export function laukMingguKe(mingguMulai: string): number {
  const n = Math.floor(diffDays(AWAL_ROTASI, mingguMulai) / 7);
  return (((n % 4) + 4) % 4) + 1;
}

export async function getShoppingWeek(db: Db, now: Date) {
  const today = wibDate(now);
  const period = await getCurrentPeriod(db);
  const mingguMulai = period && period.tanggalSelesai >= today ? period.tanggalMulai : sundayOnOrBefore(today);
  const [items, checks, lauk, menu] = await Promise.all([
    db.shoppingItem.findMany({ orderBy: { urutan: "asc" } }),
    db.shoppingCheck.findMany({ where: { mingguMulai } }),
    db.laukRotasi.findUnique({ where: { mingguKe: laukMingguKe(mingguMulai) } }),
    db.menuItem.findMany({ orderBy: [{ hari: "asc" }, { urutan: "asc" }] }),
  ]);
  const budget = period && period.tanggalMulai === mingguMulai ? (await getPeriodAllocations(db, period.id)).makan : (await getPlanFor(db, mingguMulai)).makan;

  const rows = items.map((i) => ({
    ...i,
    subtotal: Math.round(i.jumlah * i.hargaSatuan),
    dibeli: checks.some((c) => c.itemId === i.id && c.dibeli),
  }));
  const aktif = rows.filter((r) => r.aktif);
  const total = aktif.reduce((s, r) => s + r.subtotal, 0);
  const sudahDibeli = aktif.filter((r) => r.dibeli).reduce((s, r) => s + r.subtotal, 0);
  return {
    mingguMulai,
    items: rows,
    total,
    sudahDibeli,
    budget,
    selisih: budget - total,
    status: total <= budget ? ("aman" as const) : ("lewat" as const),
    lauk,
    laukKe: laukMingguKe(mingguMulai),
    menu,
    hariIni: weekdayOf(today),
  };
}

export async function updateShoppingItem(db: Db, id: number, d: { nama?: string; jumlah?: number; satuan?: string; hargaSatuan?: number; aktif?: boolean; kataKunci?: string[] }) {
  if (d.hargaSatuan !== undefined && (!Number.isInteger(d.hargaSatuan) || d.hargaSatuan < 0)) throw new AppError("invalid", "Harga tidak valid.");
  if (d.jumlah !== undefined && (!Number.isFinite(d.jumlah) || d.jumlah < 0)) throw new AppError("invalid", "Jumlah tidak valid.");
  return db.shoppingItem.update({
    where: { id },
    data: { ...d, kataKunci: d.kataKunci ? JSON.stringify(d.kataKunci.map((k) => k.toLowerCase().trim()).filter(Boolean)) : undefined },
  });
}

export async function createShoppingItem(db: Db, d: { nama: string; jumlah: number; satuan: string; hargaSatuan: number; kataKunci?: string[] }) {
  if (!d.nama.trim()) throw new AppError("invalid", "Nama item wajib diisi.");
  const max = await db.shoppingItem.aggregate({ _max: { urutan: true } });
  return db.shoppingItem.create({
    data: {
      nama: d.nama.trim(),
      jumlah: d.jumlah,
      satuan: d.satuan.trim(),
      hargaSatuan: d.hargaSatuan,
      kataKunci: JSON.stringify((d.kataKunci ?? [d.nama.split(" ")[0]]).map((k) => k.toLowerCase().trim()).filter(Boolean)),
      urutan: (max._max.urutan ?? 0) + 1,
    },
  });
}

export async function deleteShoppingItem(db: Db, id: number) {
  await db.shoppingCheck.deleteMany({ where: { itemId: id } });
  await db.shoppingItem.delete({ where: { id } });
}

export async function toggleShoppingCheck(db: Db, mingguMulai: string, itemId: number, dibeli: boolean) {
  await db.shoppingCheck.upsert({
    where: { mingguMulai_itemId: { mingguMulai, itemId } },
    update: { dibeli },
    create: { mingguMulai, itemId, dibeli },
  });
}

export async function updateMenuItem(db: Db, id: number, menu: string) {
  await db.menuItem.update({ where: { id }, data: { menu: menu.trim() } });
}

export async function updateLauk(db: Db, mingguKe: number, d: { nama: string; jumlah: string; estimasi: number }) {
  await db.laukRotasi.update({ where: { mingguKe }, data: d });
}
