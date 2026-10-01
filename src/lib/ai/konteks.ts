import type { Db } from "../db";
import { rp } from "../money";
import { addDays, HARI, weekdayOf, wibDate, wibHM } from "../time";
import { getBalances } from "../services/envelopes";
import { getDailyStatus } from "../services/daily";
import { getCurrentPeriod } from "../services/periods";
import { billsWithReadiness } from "../services/bills";
import { getGoalProgress } from "../services/goals";
import { ringkasanDebt } from "../services/debts";
import { deteksiPola, proyeksi, rataPengeluaran } from "../services/autopilot";
import { getPrestasi } from "../services/game";
import { getShoppingWeek } from "../services/shopping";
import { getSetting } from "../services/settings";

/** Berapa hari transaksi terakhir yang dikirim baris per baris. */
const HARI_RINCI = 45;
const MAKS_BARIS_TX = 220;

/**
 * Potret keuangan pemilik dalam teks ringkas untuk Claude. Semua angka dihitung oleh service layer
 * (bukan oleh AI), jadi jawaban AI berpijak pada data yang sama dengan website.
 */
export async function bangunKonteks(db: Db, now: Date): Promise<string> {
  const today = wibDate(now);
  const { jam, menit } = wibHM(now);
  const period = await getCurrentPeriod(db);
  const [nama, balances, daily, bills, goal, debts, rata, pola, prestasi, belanja, memori] = await Promise.all([
    getSetting(db, "nama_pengguna"),
    getBalances(db, period?.id ?? null),
    getDailyStatus(db, now),
    billsWithReadiness(db, now),
    getGoalProgress(db, now),
    ringkasanDebt(db, now),
    rataPengeluaran(db, now),
    deteksiPola(db, now).catch(() => []),
    getPrestasi(db, now).catch(() => null),
    getShoppingWeek(db, now).catch(() => null),
    db.aiMemori.findMany({ orderBy: { id: "asc" } }),
  ]);
  const proy = period ? await proyeksi(db, now, { minggu: 6 }).catch(() => null) : null;

  const b: string[] = [];
  b.push(`# Data keuangan ${nama} (per ${HARI[weekdayOf(today)]} ${today} jam ${String(jam).padStart(2, "0")}.${String(menit).padStart(2, "0")} WIB)`);

  if (memori.length) {
    b.push("", "## Catatan tentang pemilik (memori)");
    for (const m of memori) b.push(`- [${m.id}] ${m.isi}`);
  }

  b.push("", "## Periode minggu ini");
  if (!period) b.push("Belum ada periode aktif (uang mingguan belum dicatat).");
  else {
    b.push(`${period.tanggalMulai} s/d ${period.tanggalSelesai}. Uang mingguan ${rp(period.pemasukan)}, uang tambahan masuk ${rp(period.tambahan)}.`);
    if (daily) b.push(`Jatah makan hari ini ${rp(daily.jatahHariIni)} (sisa jatah hari ini ${rp(daily.sisaJatahHariIni)}). Saldo makan ${rp(daily.saldoMakan)} untuk ${daily.hariSisa} hari.`);
  }

  b.push("", "## Amplop (kode: saldo)");
  for (const e of balances) {
    b.push(`- ${e.kode} (${e.nama}): saldo ${rp(e.saldo)}${e.kumulatif ? " [tabungan, lintas minggu]" : `, alokasi minggu ini ${rp(e.alokasi)}, terpakai ${rp(e.terpakai)}`}${e.terkunci ? " [TERKUNCI untuk kado]" : ""}`);
  }

  const belum = bills.filter((x) => x.status === "belum");
  b.push("", "## Tagihan belum lunas");
  if (!belum.length) b.push("Tidak ada.");
  for (const t of belum) {
    b.push(`- ${t.nama} ${rp(t.nominal)} jatuh tempo ${t.jatuhTempo}${t.tanggalPasti ? "" : " (perkiraan)"}, ${t.hariLagi} hari lagi${t.cukup === null ? "" : t.cukup ? ", dana amplop cukup" : `, dana kurang ${rp(t.nominal - (t.saldoSumber ?? 0))}`}`);
  }

  if (goal) {
    b.push("", "## Target");
    b.push(
      `${goal.goal.nama}: terkumpul ${rp(goal.saldo)}, target minimal ${rp(goal.goal.targetMin)}, ideal ${rp(goal.goal.targetIdeal)}, tenggat ${goal.goal.tenggat} (${goal.hariLagi} hari lagi). ` +
        `Proyeksi kalau setoran sesuai rencana: ${rp(goal.proyeksi)} (${goal.setoranTersisa} setoran lagi). Status: ${goal.status}${goal.kurangDariMin ? `, kurang ${rp(goal.kurangDariMin)} dari minimal` : ""}.`,
    );
  }

  if (debts.rows.length) {
    b.push("", "## Utang-piutang aktif");
    for (const d of debts.rows) b.push(`- ${d.arah === "piutang" ? `${d.orang} utang ke pemilik` : `pemilik utang ke ${d.orang}`} ${rp(d.sisa)}${d.catatan ? ` (${d.catatan})` : ""}, ${d.umurHari} hari`);
  }

  b.push("", "## Kebiasaan");
  b.push(`Rata-rata pengeluaran per minggu (${rata.sumber === "riwayat" ? `${rata.sampel} minggu terakhir` : "perkiraan awal"}): makan ${rp(rata.makan)}, data ${rp(rata.data)}, darurat ${rp(rata.darurat)}.`);
  for (const p of pola) b.push(`- Pola: ${p.judul}: ${p.detail}`);
  if (prestasi) {
    b.push(`Skor minggu ini ${prestasi.skorIni?.total ?? 0}/100, level ${prestasi.level.level} (${prestasi.level.gelar}), streak catat ${prestasi.streak} hari.`);
    for (const t of prestasi.tantangan) b.push(`- Tantangan: ${t.judul} (${t.keterangan})${t.selesai ? " selesai" : t.gagal ? " gagal" : ""}`);
  }
  if (proy?.risiko.length) for (const r of proy.risiko) b.push(`- Risiko proyeksi: ${r}`);
  if (proy?.kadoSaatTenggat != null) b.push(`Proyeksi tabungan kado saat tenggat: ${rp(proy.kadoSaatTenggat)}.`);

  if (belanja) {
    b.push("", "## Belanja & menu");
    b.push(`Budget belanja minggu ini ${rp(belanja.budget)}, daftar sekarang ${rp(belanja.total)}.`);
    const item = belanja.items.filter((i) => i.aktif).map((i) => `${i.nama} ${i.jumlah} ${i.satuan} @${rp(i.hargaSatuan)}`);
    if (item.length) b.push(`Daftar belanja: ${item.join("; ")}.`);
    if (belanja.lauk) b.push(`Lauk rotasi minggu ini: ${belanja.lauk.nama} (${belanja.lauk.jumlah}).`);
    const menu = HARI.map((h, i) => {
      const isi = belanja.menu.filter((m) => m.hari === i).map((m) => `${m.waktu} ${m.menu}`);
      return isi.length ? `${h}: ${isi.join(", ")}` : null;
    }).filter(Boolean);
    if (menu.length) b.push(`Menu contoh: ${menu.join(" | ")}.`);
  }

  // Ringkasan per bulan (3 bulan) + rincian transaksi terbaru
  const dari = addDays(today, -95);
  const txs = await db.transaction.findMany({
    where: { tanggal: { gte: dari } },
    include: { envelope: true },
    orderBy: [{ tanggal: "desc" }, { id: "desc" }],
  });
  const perBulan = new Map<string, Map<string, number>>();
  for (const t of txs) {
    if (t.debtId || t.jenis === "koreksi") continue;
    const bln = t.tanggal.slice(0, 7);
    const m = perBulan.get(bln) ?? new Map<string, number>();
    m.set(t.envelope.kode, (m.get(t.envelope.kode) ?? 0) + t.nominal);
    perBulan.set(bln, m);
  }
  if (perBulan.size) {
    b.push("", "## Pengeluaran per bulan");
    for (const [bln, m] of [...perBulan.entries()].sort()) b.push(`- ${bln}: ${[...m.entries()].map(([k, v]) => `${k} ${rp(v)}`).join(", ")}`);
  }

  const batas = addDays(today, -HARI_RINCI);
  const rinci = txs.filter((t) => t.tanggal >= batas).slice(0, MAKS_BARIS_TX);
  b.push("", `## Transaksi ${HARI_RINCI} hari terakhir (tanggal | amplop | nominal | catatan)`);
  if (!rinci.length) b.push("Belum ada.");
  for (const t of rinci) b.push(`${t.tanggal} | ${t.envelope.kode} | ${t.nominal} | ${t.catatan || "-"}${t.billId ? " [bayar tagihan]" : ""}${t.debtId ? " [utang-piutang]" : ""}`);

  return b.join("\n");
}
