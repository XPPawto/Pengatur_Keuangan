import type { Db } from "../db";
import { addDays, wibDate } from "../time";
import { tokenize } from "../parser/category";

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/** Kata pertama catatan yang bermakna (untuk mengelompokkan "telur", "telur ayam" → "telur"). */
export function kunciItem(catatan: string): string | null {
  const t = tokenize(catatan).filter((w) => !["beli", "bayar", "buat", "sama", "dan", "di", "ke"].includes(w));
  return t[0] ?? null;
}

export interface Lonjakan {
  biasanya: number;
  persen: number;
}

/**
 * Bandingkan harga sebuah catatan dengan riwayat 60 hari untuk item yang sama.
 * Lonjakan = minimal 15% dan Rp1.000 di atas median, dengan minimal 2 data pembanding.
 */
export async function cekLonjakan(db: Db, catatan: string, nominal: number, now: Date, kecualiId?: number): Promise<Lonjakan | null> {
  const k = kunciItem(catatan);
  if (!k) return null;
  const rows = await db.transaction.findMany({
    where: { tanggal: { gte: addDays(wibDate(now), -60) }, catatan: { startsWith: k }, id: kecualiId ? { not: kecualiId } : undefined, billId: null, debtId: null },
    select: { nominal: true, catatan: true },
  });
  const sama = rows.filter((r) => kunciItem(r.catatan) === k).map((r) => r.nominal);
  if (sama.length < 2) return null;
  const m = median(sama);
  if (nominal >= m * 1.15 && nominal - m >= 1000) return { biasanya: m, persen: Math.round((nominal / m - 1) * 100) };
  return null;
}

export interface HargaAsli {
  itemId: number;
  nama: string;
  rencana: number;
  median: number;
  terakhir: number;
  jumlahData: number;
  /** saran harga per satuan berdasarkan median belanja asli */
  saranHargaSatuan: number;
}

/** Harga belanja asli per item daftar belanja (dari transaksi 60 hari terakhir). */
export async function hargaAsli(db: Db, now: Date): Promise<HargaAsli[]> {
  const [items, txs] = await Promise.all([
    db.shoppingItem.findMany({ where: { aktif: true } }),
    db.transaction.findMany({
      where: { tanggal: { gte: addDays(wibDate(now), -60) }, envelope: { kode: "makan" }, billId: null, debtId: null },
      orderBy: { dibuatPada: "asc" },
      select: { nominal: true, catatan: true },
    }),
  ]);
  const out: HargaAsli[] = [];
  for (const it of items) {
    let kw: string[] = [];
    try {
      kw = JSON.parse(it.kataKunci);
    } catch {
      /* abaikan */
    }
    const cocok = txs.filter((t) => {
      const k = kunciItem(t.catatan);
      return !!k && kw.includes(k) && tokenize(t.catatan).length <= 3;
    });
    if (cocok.length < 2 || it.jumlah <= 0) continue;
    const m = median(cocok.map((t) => t.nominal));
    const rencana = Math.round(it.jumlah * it.hargaSatuan);
    out.push({
      itemId: it.id,
      nama: it.nama,
      rencana,
      median: m,
      terakhir: cocok[cocok.length - 1].nominal,
      jumlahData: cocok.length,
      saranHargaSatuan: Math.round(m / it.jumlah / 100) * 100,
    });
  }
  return out;
}
