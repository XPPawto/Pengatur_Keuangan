import type { Db } from "../db";
import { normalize } from "../parser/message";
import { getCurrentPeriod } from "../services/periods";
import { laporanKeluargaText } from "../services/reports";
import { getSetting } from "../services/settings";

/**
 * Nomor keluarga (mis. orang tua) hanya bisa melihat laporan, tidak bisa mencatat atau mengubah data.
 * Bahasa sopan dan formal, berbeda dengan gaya santai untuk pemilik.
 */
export async function prosesKeluarga(db: Db, text: string, now: Date): Promise<string[]> {
  const nama = await getSetting(db, "nama_pengguna");
  const t = normalize(text);

  if (/^(laporan|ringkasan|rekap|saldo|info|cek|laporan minggu ini)$/.test(t)) {
    const period = (await getCurrentPeriod(db)) ?? (await db.period.findFirst({ where: { status: "selesai" }, orderBy: { tanggalMulai: "desc" } }));
    if (!period) return [`Belum ada data keuangan minggu ini untuk ${nama}. Laporan akan tersedia setelah uang mingguan dicatat.`];
    return [(await laporanKeluargaText(db, period.id, now, nama))!];
  }

  return [
    [
      `Halo, terima kasih sudah menghubungi DompetKos.`,
      `Nomor ini terdaftar sebagai penerima laporan keuangan mingguan ${nama}.`,
      "",
      "Balas *laporan* untuk melihat ringkasan minggu ini.",
      "Laporan otomatis dikirim setiap Sabtu malam, dan pemberitahuan dikirim saat uang mingguan diterima.",
    ].join("\n"),
  ];
}
