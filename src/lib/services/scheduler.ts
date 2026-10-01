import type { Db } from "../db";
import { rp } from "../money";
import { fmtTanggal, sundayOnOrBefore, wibDate, wibHM, wibWeekday } from "../time";
import { getDailyStatus } from "./daily";
import { getBalances } from "./envelopes";
import { enqueue } from "./outbox";
import { getCurrentPeriod, getPendingPeriod } from "./periods";
import { recipientsFor } from "./recipients";
import { laporanKeluargaLengkap, rekapLengkap } from "./game";
import { saranMingguan } from "./autopilot";
import { getSetting } from "./settings";
import { unpaidBills } from "./bills";
import { diffDays } from "../time";

export type JenisPengingat = "uang_masuk" | "pagi" | "malam" | "tagihan" | "saran" | "rekap" | "laporan_keluarga";

export const PENGINGAT: { jenis: JenisPengingat; jam: string; label: string; keterangan: string }[] = [
  { jenis: "uang_masuk", jam: "09:00", label: "Uang masuk (Minggu)", keterangan: "Mulai jam ini, ulang tiap 3 jam sampai 21.00, berhenti setelah dikonfirmasi" },
  { jenis: "pagi", jam: "07:00", label: "Jatah pagi", keterangan: "Jatah makan hari ini, menu, dan tagihan 3 hari ke depan" },
  { jenis: "malam", jam: "21:00", label: "Cek catatan malam", keterangan: "Hanya kalau hari ini belum ada catatan" },
  { jenis: "tagihan", jam: "09:00", label: "Tagihan H-3 & H-1", keterangan: "Nominal, saldo amplop, cukup atau kurang" },
  { jenis: "saran", jam: "19:00", label: "Saran autopilot (Sabtu)", keterangan: "Saran pindah uang untuk amankan tagihan & target, cukup balas ok" },
  { jenis: "rekap", jam: "20:00", label: "Rekap mingguan (Sabtu)", keterangan: "Total per amplop, streak, progres target" },
  { jenis: "laporan_keluarga", jam: "20:00", label: "Laporan keluarga (Sabtu)", keterangan: "Laporan sopan untuk nomor berperan keluarga" },
];

const JENDELA_MENIT = 10;

export async function getReminderSettings(db: Db) {
  const rows = await db.reminderSetting.findMany();
  return PENGINGAT.map((p) => {
    const r = rows.find((x) => x.jenis === p.jenis);
    return { ...p, jam: r?.jam ?? p.jam, aktif: r?.aktif ?? true };
  });
}

function menitDari(jam: string): number {
  const [h, m] = jam.split(":").map(Number);
  return h * 60 + (m || 0);
}

/** true kalau sekarang di dalam jendela [jam, jam + 10 menit) WIB — tahan banting kalau worker sempat restart. */
export function dalamJendela(now: Date, jam: string | number): boolean {
  const { jam: h, menit } = wibHM(now);
  const t = typeof jam === "number" ? jam : menitDari(jam);
  const n = h * 60 + menit;
  return n >= t && n < t + JENDELA_MENIT;
}

/** Jam-jam pengingat uang masuk hari Minggu: jam awal, lalu tiap 3 jam sampai 21.00. */
export function jadwalUangMasuk(jamAwal: string): number[] {
  const out: number[] = [];
  for (let t = menitDari(jamAwal); t <= 21 * 60; t += 180) out.push(t);
  return out;
}

async function kirimKe(db: Db, nomor: string[], jenis: string, isi: string, kunciDasar: string, now: Date) {
  let n = 0;
  for (const no of nomor) if (await enqueue(db, { nomor: no, jenis, isi, kunci: `${kunciDasar}:${no}` }, now)) n++;
  return n;
}

/**
 * Dijalankan bot worker tiap menit: masukkan pengingat yang jatuh tempo ke antrean (outbox).
 * Pengiriman (jam tenang, jeda 1 jam) diatur terpisah oleh sender.
 */
export async function jadwalkanPengingat(db: Db, now: Date): Promise<number> {
  const today = wibDate(now);
  const hari = wibWeekday(now);
  const settings = await getReminderSettings(db);
  const on = (j: JenisPengingat) => settings.find((s) => s.jenis === j)!;
  const pemilik = await recipientsFor(db, "pemilik", "pengingat");
  let total = 0;

  // Minggu: uang udah masuk?
  const um = on("uang_masuk");
  if (um.aktif && hari === 0) {
    const slot = jadwalUangMasuk(um.jam).find((t) => dalamJendela(now, t));
    if (slot !== undefined) {
      const period = await getCurrentPeriod(db);
      const sudah = period && period.tanggalMulai >= sundayOnOrBefore(today);
      if (!sudah) {
        const pending = await getPendingPeriod(db);
        const isi = pending
          ? `Usulan pembagian uang ${rp(pending.pemasukan)} belum dikonfirmasi. Balas \`ok\` kalau udah dipisahin, atau cek di website.`
          : "Uang mingguan udah masuk? Balas `masuk <nominal>`, contoh `masuk 300`.";
        total += await kirimKe(db, pemilik, "uang_masuk", isi, `uang_masuk:${today}:${slot}`, now);
      }
    }
  }

  // Pagi: jatah + menu + tagihan dekat
  const pg = on("pagi");
  if (pg.aktif && dalamJendela(now, pg.jam)) {
    const d = await getDailyStatus(db, now);
    if (d && d.hariSisa > 0) {
      const baris = [`*Jatah makan hari ini ${rp(d.jatahHariIni)}*`, `Sisa makan ${rp(d.saldoMakan)} buat ${d.hariSisa} hari.`];
      const menu = await db.menuItem.findMany({ where: { hari }, orderBy: { urutan: "asc" } });
      if (menu.length) baris.push(`Menu: ${menu.map((m) => m.menu).join(" · ")}`);
      const bills = (await unpaidBills(db)).filter((b) => {
        const h = diffDays(today, b.jatuhTempo);
        return h >= 0 && h <= 3;
      });
      for (const b of bills) {
        const h = diffDays(today, b.jatuhTempo);
        baris.push(`Tagihan ${b.nama} ${rp(b.nominal)} ${h === 0 ? "jatuh tempo HARI INI" : `jatuh tempo ${h} hari lagi (${fmtTanggal(b.jatuhTempo)})`}.`);
      }
      total += await kirimKe(db, pemilik, "pagi", baris.join("\n"), `pagi:${today}`, now);
    }
  }

  // Malam: belum ada catatan
  const ml = on("malam");
  if (ml.aktif && dalamJendela(now, ml.jam)) {
    const log = await db.dailyLog.findUnique({ where: { tanggal: today } });
    const period = await getCurrentPeriod(db);
    if (period && !(log?.adaCatatan || log?.tanpaJajan)) {
      const isi = "Udah catat pengeluaran hari ini? Ketik kayak `tempe 5k`. Kalau nggak jajan sama sekali, balas `nol` biar streak aman.";
      total += await kirimKe(db, pemilik, "malam", isi, `malam:${today}`, now);
    }
  }

  // Tagihan H-3 dan H-1
  const tg = on("tagihan");
  if (tg.aktif && dalamJendela(now, tg.jam)) {
    const period = await getCurrentPeriod(db);
    const balances = await getBalances(db, period?.id ?? null);
    for (const b of await unpaidBills(db)) {
      const h = diffDays(today, b.jatuhTempo);
      if (h !== 3 && h !== 1) continue;
      const baris = [`*Tagihan ${b.nama} ${rp(b.nominal)}* jatuh tempo ${h === 1 ? "besok" : "3 hari lagi"} (${fmtTanggal(b.jatuhTempo)}).`];
      if (b.envelope) {
        const saldo = balances.find((x) => x.id === b.envelopeId)?.saldo ?? 0;
        baris.push(saldo >= b.nominal ? `Saldo ${b.envelope.nama} ${rp(saldo)}, cukup.` : `Saldo ${b.envelope.nama} ${rp(saldo)}, kurang ${rp(b.nominal - saldo)}. Bisa \`pindah\` dari Darurat.`);
      }
      if (!b.tanggalPasti) baris.push("Tanggalnya masih perkiraan, update di website ya.");
      baris.push("Udah dibayar? Balas `bayar paylater`.");
      total += await kirimKe(db, pemilik, "tagihan", baris.join("\n"), `tagihan:${b.id}:H${h}`, now);
    }
  }

  // Sabtu: rekap pemilik & laporan keluarga
  if (hari === 6) {
    const period = await getCurrentPeriod(db);
    const sr = on("saran");
    if (period && sr.aktif && dalamJendela(now, sr.jam)) {
      const saran = await saranMingguan(db, now);
      const transfers = saran.filter((x) => x.transfer).map((x) => x.transfer!);
      if (transfers.length) {
        const isi = ["*Saran autopilot minggu ini*", ...saran.map((x, i) => `${i + 1}. *${x.judul}* — ${x.detail}`), "", `Balas "ok" buat jalankan ${transfers.length} pemindahan sekaligus.`].join("\n");
        for (const nomor of pemilik) {
          if (await enqueue(db, { nomor, jenis: "saran", isi, kunci: `saran:${period.id}:${nomor}` }, now)) {
            total++;
            await db.pendingAction.deleteMany({ where: { nomor } });
            await db.pendingAction.create({
              data: { nomor, jenis: "saran", payload: JSON.stringify({ jenis: "saran", transfers }), kedaluwarsa: new Date(now.getTime() + 12 * 3600_000) },
            });
          }
        }
      }
    }
    const rk = on("rekap");
    if (period && rk.aktif && dalamJendela(now, rk.jam)) {
      const isi = await rekapLengkap(db, period.id, now);
      const penerima = await recipientsFor(db, "pemilik", "laporan");
      if (isi) total += await kirimKe(db, penerima, "rekap", isi, `rekap:${period.id}`, now);
    }
    const lk = on("laporan_keluarga");
    if (period && lk.aktif && dalamJendela(now, lk.jam)) {
      const nama = await getSetting(db, "nama_pengguna");
      const isi = await laporanKeluargaLengkap(db, period.id, now, nama);
      const keluarga = await recipientsFor(db, "keluarga", "laporan");
      if (isi) total += await kirimKe(db, keluarga, "laporan_keluarga", isi, `laporan_keluarga:${period.id}`, now);
    }
  }

  // Tahan belanja: tanya ulang setelah 24 jam
  const holds = await db.holdRequest.findMany({ where: { hasil: "menunggu", sudahDitanya: false, tanyaUlangPada: { lte: now } } });
  for (const h of holds) {
    const isi = `Kemarin lo nahan beli *${h.barang}* (${rp(h.nominal)}). Masih mau?\nBalas \`beli\` buat dicatat, atau \`gak jadi\` (uangnya gw hitung sebagai yang diselamatkan).`;
    const tujuan = h.nomor ? [h.nomor] : pemilik;
    total += await kirimKe(db, tujuan, "tahan", isi, `tahan:${h.id}`, now);
    await db.holdRequest.update({ where: { id: h.id }, data: { sudahDitanya: true } });
  }

  return total;
}

export async function updateReminder(db: Db, jenis: JenisPengingat, jam: string, aktif: boolean) {
  if (!PENGINGAT.some((p) => p.jenis === jenis)) throw new Error("Jenis pengingat tidak dikenal.");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(jam)) throw new Error("Format jam HH:MM.");
  await db.reminderSetting.upsert({ where: { jenis }, update: { jam, aktif }, create: { jenis, jam, aktif } });
}
