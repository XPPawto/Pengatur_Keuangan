import type { Db } from "../db";
import { rp } from "../money";
import { addDays, diffDays, fmtRentang, fmtTanggalPanjang, fromWib, namaHari, wibDate } from "../time";
import type { EnvelopeKode } from "../types";
import { getStreak } from "./daily";
import { getBalances } from "./envelopes";
import { getGoalProgress } from "./goals";
import { savedTotal } from "./holds";

export interface WeekSummary {
  period: { id: number; tanggalMulai: string; tanggalSelesai: string; pemasukan: number; status: string };
  perAmplop: { kode: EnvelopeKode; nama: string; alokasi: number; terpakai: number; saldo: number; kumulatif: boolean }[];
  totalKeluar: number;
  makan: number;
  rataMakanPerHari: number;
  hariBerjalan: number;
  hariDisiplin: number;
  hemat: { total: number; jumlah: number };
  tagihanLunas: { nama: string; nominal: number }[];
}

/** Ringkasan satu periode (dipakai rekap Sabtu, laporan keluarga, halaman Rekap, dan ekspor). */
export async function weekSummary(db: Db, periodId: number, now: Date): Promise<WeekSummary | null> {
  const period = await db.period.findUnique({ where: { id: periodId } });
  if (!period) return null;
  const today = wibDate(now);
  const [balances, txs, logs, envs] = await Promise.all([
    getBalances(db, period.id),
    db.transaction.findMany({ where: { periodId }, include: { envelope: true } }),
    db.dailyLog.findMany({ where: { tanggal: { gte: period.tanggalMulai, lte: period.tanggalSelesai } } }),
    db.envelope.findMany({ orderBy: { urutanTampil: "asc" } }),
  ]);
  const akhir = today < period.tanggalSelesai ? today : period.tanggalSelesai;
  const hariBerjalan = Math.max(1, Math.min(7, diffDays(period.tanggalMulai, akhir) + 1));
  const perKode = (k: string) => txs.filter((t) => t.envelope.kode === k).reduce((s, t) => s + t.nominal, 0);
  const makan = perKode("makan");
  const [hemat, lunas] = await Promise.all([
    savedTotal(db, { dari: fromWib(period.tanggalMulai), sampai: fromWib(addDays(period.tanggalSelesai, 1)) }),
    db.bill.findMany({ where: { status: "lunas", dibayarPada: { gte: fromWib(period.tanggalMulai), lt: fromWib(addDays(period.tanggalSelesai, 1)) } } }),
  ]);
  return {
    period,
    perAmplop: envs.map((e) => {
      const b = balances.find((x) => x.id === e.id)!;
      return { kode: e.kode as EnvelopeKode, nama: e.nama, alokasi: b.alokasi, terpakai: perKode(e.kode), saldo: b.saldo, kumulatif: b.kumulatif };
    }),
    totalKeluar: txs.reduce((s, t) => s + t.nominal, 0),
    makan,
    rataMakanPerHari: Math.round(makan / hariBerjalan),
    hariBerjalan,
    hariDisiplin: logs.filter((l) => l.tanggal <= akhir && (l.adaCatatan || l.tanpaJajan)).length,
    hemat,
    tagihanLunas: lunas.map((b) => ({ nama: b.nama, nominal: b.nominal })),
  };
}

/** Rekap mingguan untuk pemilik (Sabtu 20.00), gaya santai. */
export async function rekapMingguanText(db: Db, periodId: number, now: Date): Promise<string | null> {
  const s = await weekSummary(db, periodId, now);
  if (!s) return null;
  const goal = await getGoalProgress(db, now);
  const streak = await getStreak(db, now);
  const baris = [`*Rekap minggu ${fmtRentang(s.period.tanggalMulai, s.period.tanggalSelesai)}*`, ""];
  for (const a of s.perAmplop) {
    if (a.kumulatif) baris.push(`${a.nama}: kepake ${rp(a.terpakai)}, saldo ${rp(a.saldo)}`);
    else baris.push(`${a.nama}: ${rp(a.terpakai)} dari ${rp(a.alokasi)}`);
  }
  const makan = s.perAmplop.find((a) => a.kode === "makan");
  baris.push("", `Total keluar ${rp(s.totalKeluar)}. Rata-rata makan ${rp(s.rataMakanPerHari)}/hari.`);
  if (makan && makan.saldo > 0) baris.push(`Sisa makan ${rp(makan.saldo)} bakal pindah ke Darurat pas periode baru dikonfirmasi.`);
  if (makan && makan.saldo < 0) baris.push(`Makan minggu ini jebol ${rp(-makan.saldo)}.`);
  baris.push(`Disiplin catat ${s.hariDisiplin}/${s.hariBerjalan} hari, streak ${streak} hari.`);
  if (s.hemat.total > 0) baris.push(`Diselamatkan dari tahan belanja: ${rp(s.hemat.total)}.`);
  if (goal) baris.push(`Tabungan kado ${rp(goal.saldo)} / ${rp(goal.goal.targetMin)} (${Math.round(goal.persenMin)}%), ${goal.hariLagi} hari lagi.`);
  return baris.join("\n");
}

/** Laporan untuk keluarga (orang tua): bahasa sopan, fokus ke gambaran besar. */
export async function laporanKeluargaText(db: Db, periodId: number, now: Date, nama: string): Promise<string | null> {
  const s = await weekSummary(db, periodId, now);
  if (!s) return null;
  const goal = await getGoalProgress(db, now);
  const saldoDarurat = s.perAmplop.find((a) => a.kode === "darurat")?.saldo ?? 0;
  const makan = s.perAmplop.find((a) => a.kode === "makan");
  const selesai = wibDate(now) >= s.period.tanggalSelesai;
  const baris = [
    `*Laporan Keuangan Mingguan — ${nama}*`,
    `Periode ${fmtTanggalPanjang(s.period.tanggalMulai)} s.d. ${fmtTanggalPanjang(s.period.tanggalSelesai)}${selesai ? "" : " (berjalan)"}`,
    "",
    `Uang diterima: ${rp(s.period.pemasukan)}`,
    `Total pengeluaran: ${rp(s.totalKeluar)}`,
    `• Makan: ${rp(s.makan)} dari anggaran ${rp(makan?.alokasi ?? 0)} (rata-rata ${rp(s.rataMakanPerHari)} per hari)`,
  ];
  const data = s.perAmplop.find((a) => a.kode === "data");
  if (data && data.terpakai) baris.push(`• Paket data: ${rp(data.terpakai)}`);
  const lain = s.perAmplop.filter((a) => a.kode === "darurat").reduce((x, a) => x + a.terpakai, 0);
  if (lain) baris.push(`• Kebutuhan kos & lainnya: ${rp(lain)}`);
  if (s.tagihanLunas.length) baris.push(`• Tagihan dibayar: ${s.tagihanLunas.map((t) => `${t.nama} ${rp(t.nominal)}`).join(", ")}`);
  baris.push("", `Dana darurat: ${rp(saldoDarurat)}`);
  if (goal) baris.push(`Tabungan tujuan: ${rp(goal.saldo)} dari target ${rp(goal.goal.targetMin)} (${Math.round(goal.persenMin)}%)`);
  baris.push(`Kedisiplinan mencatat: ${s.hariDisiplin} dari ${s.hariBerjalan} hari`);
  const kondisi = makan && makan.saldo < 0 ? "Pengeluaran makan minggu ini melebihi anggaran." : "Pengeluaran minggu ini masih sesuai anggaran.";
  baris.push("", kondisi, "", "_Pesan otomatis dari DompetKos. Balas *laporan* untuk ringkasan terbaru._");
  return baris.join("\n");
}

/** Ringkasan tanda terima uang mingguan untuk keluarga. */
export function konfirmasiUangText(nama: string, nominal: number, tanggal: string, alloc: Record<EnvelopeKode, number>): string {
  return [
    `*Pemberitahuan DompetKos*`,
    `Uang mingguan ${rp(nominal)} sudah diterima ${nama} pada ${namaHari(tanggal)}, ${fmtTanggalPanjang(tanggal)}.`,
    "",
    "Rencana penggunaan minggu ini:",
    `• Makan: ${rp(alloc.makan)}`,
    `• Paket data: ${rp(alloc.data)}`,
    `• Cicilan/tagihan: ${rp(alloc.paylater)}`,
    `• Tabungan: ${rp(alloc.kado)}`,
    `• Dana darurat & kebutuhan kos: ${rp(alloc.darurat)}`,
    "",
    "_Pesan otomatis dari DompetKos._",
  ].join("\n");
}

/** Data grafik halaman Rekap: pengeluaran per amplop per minggu. */
export async function weeklyStats(db: Db, now: Date, limit = 12) {
  const periods = await db.period.findMany({ where: { status: { not: "menunggu" } }, orderBy: { tanggalMulai: "desc" }, take: limit });
  const out = [];
  for (const p of periods.reverse()) {
    const s = await weekSummary(db, p.id, now);
    if (s) out.push(s);
  }
  return out;
}
