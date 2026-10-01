import type { Db } from "../db";
import { rp } from "../money";
import { parseAmount } from "../parser/amount";
import { normalize } from "../parser/message";
import { getCurrentPeriod } from "../services/periods";
import { enqueue } from "../services/outbox";
import { recipientsFor } from "../services/recipients";
import { laporanKeluargaLengkap } from "../services/game";
import { getSetting } from "../services/settings";
import { wibDate } from "../time";

const KABAR_TRANSFER = /^(?:sudah|udah|sdh|dah|barusan|baru)?\s*(?:di)?(?:transfer|tf|kirim|kirimkan|kirimin|transfer(?:kan)?)\s*(?:ya|yaa|nak|ke abdul)?\s*(?:sebesar|senilai|sejumlah)?\s*(?:rp\.?)?\s*([\d.,]+\s*(?:k|rb|ribu|jt|juta)?)/;

/**
 * Nomor keluarga (mis. Ayah) hanya bisa melihat laporan & mengabari kiriman, tidak bisa mencatat atau mengubah data.
 * Bahasa sopan dan formal, berbeda dengan gaya santai untuk pemilik.
 */
export async function prosesKeluarga(db: Db, nomor: string, text: string, now: Date): Promise<string[]> {
  const nama = await getSetting(db, "nama_pengguna");
  const t = normalize(text);

  if (/^(laporan|ringkasan|rekap|saldo|info|cek|laporan minggu ini)$/.test(t)) {
    const period = (await getCurrentPeriod(db)) ?? (await db.period.findFirst({ where: { status: "selesai" }, orderBy: { tanggalMulai: "desc" } }));
    if (!period) return [`Belum ada data keuangan minggu ini untuk ${nama}. Laporan akan tersedia setelah uang mingguan dicatat.`];
    return [(await laporanKeluargaLengkap(db, period.id, now, nama))!];
  }

  // "sudah transfer 100rb", "udah tf 50k ya nak", "kirim 100.000"
  const kabar = KABAR_TRANSFER.exec(t);
  const nominal = kabar ? parseAmount(kabar[1]) : null;
  if (nominal) {
    const pengirim = (await db.allowedNumber.findUnique({ where: { nomor } }))?.label || "Keluarga";
    const panggilan = /ayah|bapak|papa/i.test(pengirim) ? "ayah" : /ibu|mama|bunda/i.test(pengirim) ? "ibu" : pengirim.toLowerCase().split(" ")[0];
    const isi = `${pengirim} bilang udah transfer ${rp(nominal)}. Kalau uangnya udah masuk, balas \`${panggilan} kirim ${Math.round(nominal / 1000)}k\` biar tercatat & tanda terimanya terkirim.`;
    for (const owner of await recipientsFor(db, "pemilik")) {
      await enqueue(db, { nomor: owner, jenis: "info_kiriman", isi, kunci: `info_kiriman:${nomor}:${nominal}:${wibDate(now)}:${owner}` }, now);
    }
    return [`Terima kasih, kabar transfer ${rp(nominal)} sudah diteruskan ke ${nama}. Tanda terima akan dikirim setelah dananya dikonfirmasi masuk.`];
  }

  return [
    [
      `Halo, terima kasih sudah menghubungi DompetKos.`,
      `Nomor ini terdaftar sebagai penerima laporan keuangan mingguan ${nama}.`,
      "",
      "• Balas *laporan* untuk melihat ringkasan minggu ini.",
      "• Kalau baru mengirim uang, balas misalnya *sudah transfer 100rb* supaya langsung diteruskan.",
      "",
      "Laporan otomatis dikirim setiap Sabtu malam, dan pemberitahuan dikirim saat uang diterima.",
    ].join("\n"),
  ];
}
