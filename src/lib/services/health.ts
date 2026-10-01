import fs from "node:fs";
import path from "node:path";
import type { Db } from "../db";
import { wibDate } from "../time";
import { BACKUP_DIR, listBackups } from "./backup";
import { enqueue } from "./outbox";
import { recipientsFor } from "./recipients";
import { statusAI } from "../ai/panggil";
import { berkasTerbuka } from "../keamanan/berkas";

export type Status = "ok" | "peringatan" | "masalah";

export interface Cek {
  kode: string;
  nama: string;
  status: Status;
  detail: string;
}

function ukuranFolder(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    total += f.isDirectory() ? ukuranFolder(p) : fs.statSync(p).size;
  }
  return total;
}

function dbFile(): string | null {
  const url = process.env.DATABASE_URL ?? "";
  if (!url.startsWith("file:")) return null;
  return path.resolve("prisma", url.slice(5));
}

const MB = 1024 * 1024;

/** Pemeriksaan kesehatan: bot, WhatsApp, antrean pesan, backup, penyimpanan. */
export async function cekKesehatan(db: Db, now: Date) {
  const [conn, antri, tertua, gagal24, firstPeriod, txCount, periodCount, actCount] = await Promise.all([
    db.waConnection.findUnique({ where: { id: 1 } }),
    db.outbox.count({ where: { status: "antri" } }),
    db.outbox.findFirst({ where: { status: "antri", dijadwalkan: { lte: now } }, orderBy: { dijadwalkan: "asc" } }),
    db.outbox.count({ where: { status: "gagal", dibuatPada: { gte: new Date(now.getTime() - 86400_000) } } }),
    db.period.findFirst({ orderBy: { tanggalMulai: "asc" } }),
    db.transaction.count(),
    db.period.count(),
    db.activityLog.count(),
  ]);
  const cek: Cek[] = [];

  const ping = conn?.workerPing;
  const botHidup = !!ping && now.getTime() - ping.getTime() < 60_000;
  cek.push({
    kode: "bot",
    nama: "Proses bot",
    status: botHidup ? "ok" : "masalah",
    detail: botHidup ? "Berjalan" : ping ? `Tidak ada detak sejak ${Math.round((now.getTime() - ping.getTime()) / 60000)} menit lalu` : "Belum pernah berjalan",
  });
  cek.push({
    kode: "wa",
    nama: "WhatsApp",
    status: conn?.status === "terhubung" ? "ok" : conn?.status === "menunggu_pairing" ? "peringatan" : "masalah",
    detail: conn?.status === "terhubung" ? `Terhubung${conn.nomorBot ? ` (+${conn.nomorBot})` : ""}` : conn?.alasan ?? "Terputus",
  });

  const umurAntri = tertua ? Math.round((now.getTime() - tertua.dijadwalkan.getTime()) / 60000) : 0;
  cek.push({
    kode: "antrean",
    nama: "Antrean pesan",
    status: gagal24 > 0 || umurAntri > 180 ? "masalah" : umurAntri > 30 ? "peringatan" : "ok",
    detail: `${antri} menunggu${tertua ? `, tertua ${umurAntri} menit` : ""}${gagal24 ? `, ${gagal24} gagal dalam 24 jam` : ""}`,
  });

  const backups = listBackups();
  const terakhir = backups[0];
  const umurBackupHari = terakhir ? (now.getTime() - terakhir.waktu.getTime()) / 86400_000 : null;
  const sudahPerlu = !!firstPeriod && wibDate(now) > firstPeriod.tanggalMulai && (now.getTime() - new Date(`${firstPeriod.tanggalMulai}T00:00:00+07:00`).getTime()) / 86400_000 > 7;
  cek.push({
    kode: "backup",
    nama: "Backup",
    status: umurBackupHari === null ? (sudahPerlu ? "masalah" : "peringatan") : umurBackupHari > 8 ? "masalah" : "ok",
    detail: terakhir ? `Terakhir ${Math.floor(umurBackupHari!)} hari lalu, ${backups.length} salinan` : "Belum ada backup",
  });

  let bebas: number | null = null;
  try {
    const st = fs.statfsSync(path.resolve("."));
    bebas = st.bavail * st.bsize;
  } catch {
    /* tidak didukung */
  }
  const file = dbFile();
  const ukuranDb = file && fs.existsSync(file) ? fs.statSync(file).size : 0;
  cek.push({
    kode: "disk",
    nama: "Penyimpanan",
    status: bebas !== null && bebas < 200 * MB ? "masalah" : bebas !== null && bebas < 1024 * MB ? "peringatan" : "ok",
    detail: `Database ${(ukuranDb / MB).toFixed(1)} MB · backup ${(ukuranFolder(BACKUP_DIR) / MB).toFixed(1)} MB${bebas !== null ? ` · sisa disk ${(bebas / 1024 / MB).toFixed(1)} GB` : ""}`,
  });

  const terbuka = berkasTerbuka();
  cek.push({
    kode: "izin",
    nama: "Izin file data",
    status: terbuka.length ? "masalah" : "ok",
    detail: terbuka.length ? `Bisa dibaca user lain di server: ${terbuka.join(", ")}` : ".env dan folder data hanya bisa dibaca pemilik",
  });

  const ai = await statusAI(db, now);
  cek.push({
    kode: "ai",
    nama: "Asisten AI (Claude)",
    // Claude bermasalah tapi cadangan siap = peringatan saja (asisten tetap jalan)
    status: !ai.aktif || ai.kondisi === "belum_diatur" || ai.kondisi === "dimatikan" ? "ok" : ["belum_login", "tidak_ada"].includes(ai.kondisi) ? (ai.siap ? "peringatan" : "masalah") : ["limit", "kuota", "sibuk", "timeout", "gagal"].includes(ai.kondisi) ? "peringatan" : "ok",
    detail: [
      !ai.aktif ? "Dimatikan" : ai.kondisi === "belum_diatur" ? "Claude belum disambungkan (opsional)" : `Claude: ${ai.label} · ${ai.pemakaian.hariIni}/${ai.pemakaian.batas} pemakaian hari ini`,
      ...ai.cadangan.filter((c) => c.aktif).map((c) => `cadangan ${c.label}: ${c.ada ? c.labelKondisi : "belum disambungkan"}`),
    ].join(" · "),
  });

  const status: Status = cek.some((c) => c.status === "masalah") ? "masalah" : cek.some((c) => c.status === "peringatan") ? "peringatan" : "ok";
  return {
    status,
    cek,
    statistik: { transaksi: txCount, periode: periodCount, aktivitas: actCount, ukuranDb },
    versi: { node: process.version, app: process.env.npm_package_version ?? "0.2.0" },
  };
}

/**
 * Dijalankan bot tiap 30 menit: kirim peringatan ke pemilik kalau backup gagal/terlambat, antrean macet,
 * atau disk hampir penuh. Maksimal sekali sehari per masalah.
 */
export async function alarmKesehatan(db: Db, now: Date): Promise<number> {
  const h = await cekKesehatan(db, now);
  const masalah = h.cek.filter((c) => c.status === "masalah" && ["backup", "antrean", "disk"].includes(c.kode));
  if (!masalah.length) return 0;
  const pemilik = await recipientsFor(db, "pemilik");
  let n = 0;
  for (const c of masalah) {
    const isi = `*Peringatan sistem DompetKos*\n${c.nama}: ${c.detail}.\nCek halaman Sistem di website.`;
    for (const nomor of pemilik) if (await enqueue(db, { nomor, jenis: "sistem", isi, kunci: `sistem:${c.kode}:${wibDate(now)}:${nomor}` }, now)) n++;
  }
  return n;
}
