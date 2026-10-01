import ExcelJS from "exceljs";
import type { Db } from "../db";
import { fmtRentang, wibHM } from "../time";
import { getStreak } from "./daily";
import { getBalances } from "./envelopes";
import { getGoalProgress } from "./goals";
import { savedTotal } from "./holds";
import { getCurrentPeriod } from "./periods";
import { weeklyStats } from "./reports";
import { getShoppingWeek } from "./shopping";

const RP = '"Rp"#,##0;[Red]-"Rp"#,##0';

function header(ws: ExcelJS.Worksheet) {
  const row = ws.getRow(1);
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F766E" } };
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

/**
 * Ekspor Excel mengikuti struktur spreadsheet lama: sheet "Belanja Makan", "Budget Mingguan", "Ringkasan".
 * Semua angka diambil dari service yang sama dengan website.
 */
export async function buildWorkbook(db: Db, now: Date): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "DompetKos";
  wb.created = now;

  // 1. Belanja Makan
  const shop = await getShoppingWeek(db, now);
  const s1 = wb.addWorksheet("Belanja Makan");
  s1.columns = [
    { header: "Item", key: "nama", width: 34 },
    { header: "Jumlah", key: "jumlah", width: 10 },
    { header: "Satuan", key: "satuan", width: 14 },
    { header: "Harga satuan", key: "harga", width: 16, style: { numFmt: RP } },
    { header: "Subtotal", key: "subtotal", width: 16, style: { numFmt: RP } },
    { header: "Aktif", key: "aktif", width: 8 },
  ];
  header(s1);
  for (const i of shop.items) s1.addRow({ nama: i.nama, jumlah: i.jumlah, satuan: i.satuan, harga: i.hargaSatuan, subtotal: i.subtotal, aktif: i.aktif ? "Ya" : "Tidak" });
  s1.addRow({});
  s1.addRow({ nama: "Total (item aktif)", subtotal: shop.total }).font = { bold: true };
  s1.addRow({ nama: "Budget makan minggu ini", subtotal: shop.budget });
  s1.addRow({ nama: `Status: ${shop.status === "aman" ? "Aman" : "Lewat budget"}`, subtotal: shop.selisih });

  // 2. Budget Mingguan
  const weeks = await weeklyStats(db, now, 520);
  const envs = await db.envelope.findMany({ orderBy: { urutanTampil: "asc" } });
  const s2 = wb.addWorksheet("Budget Mingguan");
  const cols: Partial<ExcelJS.Column>[] = [
    { header: "Periode", key: "periode", width: 16 },
    { header: "Mulai", key: "mulai", width: 12 },
    { header: "Uang mingguan", key: "pemasukan", width: 14, style: { numFmt: RP } },
    { header: "Tambahan", key: "tambahan", width: 12, style: { numFmt: RP } },
  ];
  for (const e of envs) {
    cols.push({ header: `${e.nama} (alokasi)`, key: `${e.kode}_a`, width: 16, style: { numFmt: RP } });
    cols.push({ header: `${e.nama} (terpakai)`, key: `${e.kode}_t`, width: 16, style: { numFmt: RP } });
  }
  cols.push(
    { header: "Total keluar", key: "total", width: 14, style: { numFmt: RP } },
    { header: "Rata makan/hari", key: "rata", width: 16, style: { numFmt: RP } },
    { header: "Hari disiplin", key: "disiplin", width: 13 },
  );
  s2.columns = cols;
  header(s2);
  for (const w of weeks) {
    const row: Record<string, unknown> = {
      periode: fmtRentang(w.period.tanggalMulai, w.period.tanggalSelesai),
      mulai: w.period.tanggalMulai,
      pemasukan: w.period.pemasukan,
      tambahan: w.period.tambahan,
      total: w.totalKeluar,
      rata: w.rataMakanPerHari,
      disiplin: `${w.hariDisiplin}/${w.hariBerjalan}`,
    };
    for (const a of w.perAmplop) {
      row[`${a.kode}_a`] = a.alokasi;
      row[`${a.kode}_t`] = a.terpakai;
    }
    s2.addRow(row);
  }

  // 3. Ringkasan
  const period = await getCurrentPeriod(db);
  const [balances, goal, hemat, streak, bills, totalTx] = await Promise.all([
    getBalances(db, period?.id ?? null),
    getGoalProgress(db, now),
    savedTotal(db),
    getStreak(db, now),
    db.bill.findMany({ where: { status: "belum" }, orderBy: { jatuhTempo: "asc" } }),
    db.transaction.aggregate({ _sum: { nominal: true } }),
  ]);
  const s3 = wb.addWorksheet("Ringkasan");
  s3.columns = [
    { header: "Keterangan", key: "k", width: 38 },
    { header: "Nilai", key: "v", width: 22 },
  ];
  header(s3);
  const add = (k: string, v: string | number, uang = true) => {
    const r = s3.addRow({ k, v });
    if (uang && typeof v === "number") r.getCell(2).numFmt = RP;
  };
  add("Periode aktif", period ? fmtRentang(period.tanggalMulai, period.tanggalSelesai) : "-", false);
  for (const b of balances) add(`Saldo ${b.nama}`, b.saldo);
  if (goal) {
    add(`Target: ${goal.goal.nama}`, `${goal.goal.targetMin} – ${goal.goal.targetIdeal}`, false);
    add("Tabungan terkumpul", goal.saldo);
    add("Proyeksi saat tenggat", goal.proyeksi);
    add("Tenggat", goal.goal.tenggat, false);
  }
  add("Total pengeluaran (semua periode)", totalTx._sum.nominal ?? 0);
  add("Uang diselamatkan (tahan belanja)", hemat.total);
  add("Streak disiplin (hari)", streak, false);
  for (const b of bills) add(`Tagihan ${b.nama} ${b.jatuhTempo}`, b.nominal);
  const { jam, menit } = wibHM(now);
  add("Diekspor", `${now.toISOString().slice(0, 10)} ${String(jam).padStart(2, "0")}:${String(menit).padStart(2, "0")} WIB`, false);

  return Buffer.from(await wb.xlsx.writeBuffer());
}

function csvCell(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function buildTransactionsCsv(db: Db): Promise<string> {
  const txs = await db.transaction.findMany({ include: { envelope: true }, orderBy: [{ tanggal: "asc" }, { id: "asc" }] });
  const rows = [["tanggal", "amplop", "nominal", "catatan", "sumber", "pesan_asli"]];
  for (const t of txs) rows.push([t.tanggal, t.envelope.nama, String(t.nominal), t.catatan, t.sumber, t.pesanAsli ?? ""]);
  return "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\n");
}
