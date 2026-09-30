import type { Db } from "../db";
import { rp } from "../money";
import { AppError } from "../services/errors";
import { mergeDictionary, DEFAULT_DICTIONARY, type CategoryDictionary } from "../parser/category";
import { parseMessage, type ExpenseItem, type ParsedMessage } from "../parser/message";
import { getBalances } from "../services/envelopes";
import { getDailyStatus, getStreak, markTanpaJajan } from "../services/daily";
import { addBonus, cancelPendingPeriod, getCurrentPeriod, getPeriodAllocations, proposePeriod } from "../services/periods";
import { deleteTransaction, lastTransaction, listTransactions, recordExpense, updateTransaction } from "../services/transactions";
import { confirmPeriodAndNotify } from "../services/notify";
import { nextPaylaterBill, payBill, billsWithReadiness } from "../services/bills";
import { transferBetween } from "../services/transfers";
import { analyzePurchase, createHold, decideHold, latestAskedHold } from "../services/holds";
import { getGoalProgress } from "../services/goals";
import { rekapMingguanText } from "../services/reports";
import { getShoppingWeek } from "../services/shopping";
import { getSettingNumber } from "../services/settings";
import { peranNomor } from "../services/recipients";
import { addDays, fmtTanggal, fmtTanggalPanjang, wibDate, wibHM } from "../time";
import { ENVELOPE_KODE, KATA_BUKA_KUNCI, type EnvelopeKode } from "../types";
import { normalizePhone } from "../whitelist";
import { prosesKeluarga } from "./family";
import {
  BANTUAN,
  BELUM_ADA_PERIODE,
  NAMA_PENDEK,
  TAK_PAHAM,
  hariIniList,
  pilihanBernomor,
  ringkasAmplop,
  statusJatah,
  usulanPeriode,
} from "./messages";

export interface IncomingMessage {
  nomor: string;
  text: string;
  now: Date;
}

/** Pilihan amplop saat kategori tidak jelas (Tabungan kado & Paylater sengaja tidak ditawarkan). */
const PILIHAN_KATEGORI: EnvelopeKode[] = ["makan", "data", "darurat"];
const PILIHAN_BONUS: EnvelopeKode[] = ["makan", "data", "paylater", "kado", "darurat"];

type Pending =
  | { jenis: "masuk"; periodId: number; result: Parameters<typeof usulanPeriode>[1] }
  | { jenis: "bonus"; nominal: number }
  | { jenis: "batal"; txId: number }
  | { jenis: "kategori"; items: ExpenseItem[]; raw: string; tanggal?: string }
  | { jenis: "tahan"; barang: string; nominal: number; raw: string }
  | { jenis: "pindah_kado"; dari: EnvelopeKode; ke: EnvelopeKode; nominal: number; alasan: string }
  | { jenis: "pindah_alasan"; dari: EnvelopeKode; ke: EnvelopeKode; nominal: number };

const PENDING_TTL_MS: Record<Pending["jenis"], number> = {
  masuk: 12 * 3600_000,
  bonus: 2 * 3600_000,
  batal: 30 * 60_000,
  kategori: 30 * 60_000,
  tahan: 60 * 60_000,
  pindah_kado: 15 * 60_000,
  pindah_alasan: 15 * 60_000,
};

async function loadDictionary(db: Db): Promise<CategoryDictionary> {
  const items = await db.shoppingItem.findMany({ where: { aktif: true } });
  const extra: CategoryDictionary = {};
  for (const it of items) {
    let kw: string[] = [];
    try {
      kw = JSON.parse(it.kataKunci);
    } catch {
      /* abaikan kata kunci rusak */
    }
    const kode = it.envelopeKode as EnvelopeKode;
    extra[kode] = [...(extra[kode] ?? []), ...kw];
  }
  return mergeDictionary(DEFAULT_DICTIONARY, extra);
}

async function getPending(db: Db, nomor: string, now: Date): Promise<Pending | null> {
  await db.pendingAction.deleteMany({ where: { kedaluwarsa: { lt: now } } });
  const row = await db.pendingAction.findFirst({ where: { nomor }, orderBy: { id: "desc" } });
  if (!row) return null;
  return { ...(JSON.parse(row.payload) as object), jenis: row.jenis } as Pending;
}

async function setPending(db: Db, nomor: string, p: Pending, now: Date) {
  await db.pendingAction.deleteMany({ where: { nomor } });
  await db.pendingAction.create({
    data: { nomor, jenis: p.jenis, payload: JSON.stringify(p), kedaluwarsa: new Date(now.getTime() + PENDING_TTL_MS[p.jenis]) },
  });
}

async function clearPending(db: Db, nomor: string) {
  await db.pendingAction.deleteMany({ where: { nomor } });
}

/** Titik masuk bot: pesan masuk → daftar balasan. Semua logika ada di service layer. */
export async function handleMessage(db: Db, msg: IncomingMessage): Promise<string[]> {
  const nomor = normalizePhone(msg.nomor);
  const now = msg.now;
  const peran = await peranNomor(db, nomor);

  if (!peran) {
    await db.messageLog.create({ data: { arah: "masuk", nomor, isi: "[diabaikan: nomor tidak terdaftar]", waktu: now } });
    return [];
  }
  await db.messageLog.create({ data: { arah: "masuk", nomor, isi: msg.text, waktu: now } });

  let replies: string[];
  try {
    replies = peran === "keluarga" ? await prosesKeluarga(db, msg.text, now) : await proses(db, nomor, msg.text, now);
  } catch (e) {
    if (e instanceof AppError) replies = [e.code === "no_period" ? BELUM_ADA_PERIODE : e.message];
    else {
      console.error("[bot] error tak terduga:", e);
      replies = ["Waduh, ada error di sisi gw. Coba lagi bentar ya, atau catat lewat website."];
    }
  }
  for (const r of replies) await db.messageLog.create({ data: { arah: "keluar", nomor, isi: r, waktu: now } });
  return replies;
}

async function proses(db: Db, nomor: string, text: string, now: Date): Promise<string[]> {
  const dict = await loadDictionary(db);
  const parsed = parseMessage(text, dict);
  const pending = await getPending(db, nomor, now);

  if (pending) {
    const jawaban = await jawabPending(db, nomor, pending, parsed, text, now);
    if (jawaban) return jawaban;
    // pesan lain = mulai urusan baru, percakapan lama dibuang
    if (parsed.type !== "ok" && parsed.type !== "pilihan") await clearPending(db, nomor);
  }

  switch (parsed.type) {
    case "bantuan":
      return [BANTUAN];
    case "sisa":
      return cmdSisa(db, now);
    case "jatah": {
      const d = await getDailyStatus(db, now);
      return [d ? statusJatah(d) : BELUM_ADA_PERIODE];
    }
    case "hari_ini":
      return cmdHariIni(db, now);
    case "nol":
      return cmdNol(db, now);
    case "batal":
      return cmdBatal(db, nomor, now);
    case "ubah":
      return cmdUbah(db, parsed.nominal, now);
    case "masuk":
      return cmdMasuk(db, nomor, parsed.nominal, now);
    case "expense":
      return catat(db, nomor, parsed.items, text, now, parsed.kemarin ? addDays(wibDate(now), -1) : undefined);
    case "bayar_paylater":
      return cmdBayarPaylater(db, parsed.nominal, text, now);
    case "tagihan":
      return cmdTagihan(db, now);
    case "target":
      return cmdTarget(db, now);
    case "rekap":
    case "laporan":
      return cmdRekap(db, now);
    case "pindah":
      return cmdPindah(db, nomor, parsed, now);
    case "mau_beli":
      return cmdMauBeli(db, nomor, parsed.barang, parsed.nominal, text, now);
    case "belanja":
      return cmdBelanja(db, now);
    case "menu":
      return cmdMenu(db, now);
    case "beli":
    case "tidak": {
      const h = await latestAskedHold(db);
      if (h) return putuskanTahan(db, h.id, parsed.type === "beli" ? "beli" : "batal", now);
      return ["Nggak ada yang lagi nunggu konfirmasi. Ketik `bantuan` kalau butuh contoh."];
    }
    case "ok":
    case "pilihan":
    case "yakin_ambil":
      return ["Nggak ada yang lagi nunggu konfirmasi. Ketik `bantuan` kalau butuh contoh."];
    default:
      return [/^[a-z\s]+$/i.test(text.trim()) ? `Nominalnya berapa? Contoh: \`${text.trim()} 5k\`` : TAK_PAHAM];
  }
}

/** Jawaban untuk percakapan yang lagi menunggu. null = pesan ini bukan jawaban. */
async function jawabPending(db: Db, nomor: string, p: Pending, parsed: ParsedMessage, text: string, now: Date): Promise<string[] | null> {
  const batalin = parsed.type === "tidak" || parsed.type === "batal";
  const selesai = async (r: string[]) => {
    await clearPending(db, nomor);
    return r;
  };

  switch (p.jenis) {
    case "masuk":
      if (parsed.type === "ok") return konfirmasiMasuk(db, nomor, p.periodId, now);
      if (batalin) {
        await cancelPendingPeriod(db, p.periodId);
        return selesai(["Oke, uang masuk dibatalin. Balas `masuk <nominal>` kalau mau ulang."]);
      }
      return null;
    case "bonus":
      if (parsed.type === "ok") return terapkanBonus(db, nomor, p.nominal, null);
      if (parsed.type === "pilihan" && parsed.n <= PILIHAN_BONUS.length) return terapkanBonus(db, nomor, p.nominal, PILIHAN_BONUS[parsed.n - 1]);
      if (batalin) return selesai(["Oke, uang ekstra nggak dicatat."]);
      return null;
    case "batal":
      if (parsed.type === "ok") {
        await clearPending(db, nomor);
        const tx = await deleteTransaction(db, p.txId, now).catch(() => null);
        return [tx ? `Kehapus: ${tx.catatan || "(tanpa catatan)"} ${rp(tx.nominal)}.` : "Catatan itu udah nggak ada."];
      }
      if (batalin) return selesai(["Oke, nggak jadi dihapus."]);
      return null;
    case "kategori":
      if (parsed.type === "pilihan" && parsed.n <= PILIHAN_KATEGORI.length) return lanjutKategori(db, nomor, p, PILIHAN_KATEGORI[parsed.n - 1], now);
      if (batalin) return selesai(["Oke, nggak jadi dicatat."]);
      return null;
    case "tahan":
      if (parsed.type === "ok" || (parsed.type === "pilihan" && parsed.n === 1)) {
        const h = await createHold(db, { barang: p.barang, nominal: p.nominal, nomor, now });
        const { jam, menit } = wibHM(h.tanyaUlangPada);
        return selesai([`Sip, ditahan dulu. Besok jam ${String(jam).padStart(2, "0")}.${String(menit).padStart(2, "0")} gw tanya lagi masih mau atau nggak.`]);
      }
      if ((parsed.type === "pilihan" && parsed.n === 2) || parsed.type === "beli") {
        await clearPending(db, nomor);
        return simpanItems(db, [{ nama: p.barang, nominal: p.nominal, assumedThousand: false, kode: "darurat" }], p.raw, now);
      }
      if ((parsed.type === "pilihan" && parsed.n === 3) || batalin) {
        const h = await createHold(db, { barang: p.barang, nominal: p.nominal, nomor, now });
        await decideHold(db, h.id, "batal", now, "wa");
        return selesai([`Mantap, ${rp(p.nominal)} diselamatkan. Tercatat di rekap hemat.`]);
      }
      return null;
    case "pindah_kado":
      if (parsed.type === "yakin_ambil") {
        await clearPending(db, nomor);
        return jalankanPindah(db, p.dari, p.ke, p.nominal, p.alasan, now, KATA_BUKA_KUNCI);
      }
      if (batalin) return selesai(["Aman, tabungan kado nggak disentuh."]);
      if (parsed.type === "ok") return [`Harus ketik persis: ${KATA_BUKA_KUNCI}`];
      return null;
    case "pindah_alasan": {
      if (batalin) return selesai(["Oke, nggak jadi pindah."]);
      const alasan = text.trim();
      if (!alasan || parsed.type !== "unknown") return null;
      await clearPending(db, nomor);
      return mulaiPindah(db, nomor, p.dari, p.ke, p.nominal, alasan, now);
    }
  }
}

// ---------------------------------------------------------------- cek

async function cmdSisa(db: Db, now: Date): Promise<string[]> {
  const period = await getCurrentPeriod(db);
  if (!period) return [BELUM_ADA_PERIODE];
  const [balances, daily] = await Promise.all([getBalances(db, period.id), getDailyStatus(db, now)]);
  return [[`*Sisa amplop* (${fmtTanggal(period.tanggalMulai)}–${fmtTanggal(period.tanggalSelesai)})`, ringkasAmplop(balances), "", statusJatah(daily!)].join("\n")];
}

async function cmdHariIni(db: Db, now: Date): Promise<string[]> {
  const tanggal = wibDate(now);
  const rows = await listTransactions(db, { tanggal });
  return [hariIniList(tanggal, rows.reverse())];
}

async function cmdNol(db: Db, now: Date): Promise<string[]> {
  await markTanpaJajan(db, now);
  const streak = await getStreak(db, now);
  return [`Oke, hari ini dicatat nggak jajan. Streak disiplin ${streak} hari.`];
}

async function cmdRekap(db: Db, now: Date): Promise<string[]> {
  const period = await getCurrentPeriod(db);
  if (!period) return [BELUM_ADA_PERIODE];
  return [(await rekapMingguanText(db, period.id, now)) ?? BELUM_ADA_PERIODE];
}

async function cmdTarget(db: Db, now: Date): Promise<string[]> {
  const g = await getGoalProgress(db, now);
  if (!g) return ["Belum ada target yang diatur."];
  const baris = [
    `*${g.goal.nama}*`,
    `Terkumpul ${rp(g.saldo)} dari ${rp(g.goal.targetMin)} (${Math.round(g.persenMin)}%), ideal ${rp(g.goal.targetIdeal)}.`,
    `Tenggat ${fmtTanggalPanjang(g.goal.tenggat)}: ${g.hariLagi >= 0 ? `${g.hariLagi} hari lagi` : "sudah lewat"}.`,
  ];
  if (g.status === "tercapai") baris.push("Target minimal udah tercapai. Keren!");
  else {
    baris.push(`Proyeksi kalau setoran sesuai rencana (${g.setoranTersisa}x lagi): ${rp(g.proyeksi)}.`);
    if (g.status === "kurang") baris.push(`Masih kurang ${rp(g.kurangDariMin)} dari target minimal. Coba tahan belanja non-makan dulu.`);
    else baris.push(g.status === "ideal" ? "Jalur aman sampai target ideal." : "Jalur aman buat target minimal.");
    if (g.estimasiTercapai) baris.push(`Perkiraan tembus minimal: minggu ${fmtTanggal(g.estimasiTercapai)}.`);
  }
  return [baris.join("\n")];
}

async function cmdTagihan(db: Db, now: Date): Promise<string[]> {
  const bills = (await billsWithReadiness(db, now)).filter((b) => b.status === "belum");
  if (bills.length === 0) return ["Nggak ada tagihan yang belum lunas."];
  const baris = ["*Tagihan belum lunas*"];
  for (const b of bills) {
    const kapan = b.hariLagi < 0 ? `telat ${-b.hariLagi} hari` : b.hariLagi === 0 ? "hari ini" : `${b.hariLagi} hari lagi`;
    const siap = b.cukup === null ? "" : b.cukup ? " · dana cukup" : ` · kurang ${rp(b.nominal - (b.saldoSumber ?? 0))}`;
    baris.push(`• ${b.nama} ${rp(b.nominal)}, ${fmtTanggal(b.jatuhTempo)}${b.tanggalPasti ? "" : " (perkiraan)"} — ${kapan}${siap}`);
  }
  return [baris.join("\n")];
}

async function cmdBelanja(db: Db, now: Date): Promise<string[]> {
  const w = await getShoppingWeek(db, now);
  const baris = [`*Belanja minggu ${fmtTanggal(w.mingguMulai)}*`];
  for (const i of w.items.filter((x) => x.aktif)) {
    baris.push(`${i.dibeli ? "[x]" : "[ ]"} ${i.nama} — ${i.jumlah} ${i.satuan} ${rp(i.subtotal)}`);
  }
  baris.push("", `Total ${rp(w.total)} dari budget ${rp(w.budget)} — ${w.status === "aman" ? `aman, sisa ${rp(w.selisih)}` : `lewat ${rp(-w.selisih)}`}.`);
  if (w.lauk) baris.push(`Lauk rotasi minggu ke-${w.laukKe}: ${w.lauk.nama} (${w.lauk.jumlah}).`);
  return [baris.join("\n")];
}

async function cmdMenu(db: Db, now: Date): Promise<string[]> {
  const w = await getShoppingWeek(db, now);
  const hari = w.menu.filter((m) => m.hari === w.hariIni);
  const baris = [`*Menu hari ini*`];
  for (const m of hari) baris.push(`• ${m.waktu[0].toUpperCase()}${m.waktu.slice(1)}: ${m.menu}`);
  if (w.lauk) baris.push("", `Lauk rotasi minggu ini: ${w.lauk.nama} (${w.lauk.jumlah}).`);
  return [baris.join("\n")];
}

// ---------------------------------------------------------------- ubah data

async function cmdBatal(db: Db, nomor: string, now: Date): Promise<string[]> {
  const tx = await lastTransaction(db);
  if (!tx) return ["Belum ada catatan yang bisa dibatalin."];
  await setPending(db, nomor, { jenis: "batal", txId: tx.id }, now);
  return [`Hapus catatan terakhir: ${tx.catatan || "(tanpa catatan)"} ${rp(tx.nominal)} [${NAMA_PENDEK[tx.envelope.kode as EnvelopeKode]}], ${fmtTanggal(tx.tanggal)}?\nBalas "ok" buat hapus, atau "batal".`];
}

async function cmdUbah(db: Db, nominal: number | null, now: Date): Promise<string[]> {
  if (!nominal) return ["Nominal barunya berapa? Contoh: `ubah 12k`."];
  const tx = await lastTransaction(db);
  if (!tx) return ["Belum ada catatan yang bisa diubah."];
  await updateTransaction(db, tx.id, { nominal }, now);
  return [`Catatan terakhir (${tx.catatan || "tanpa catatan"}) diubah ${rp(tx.nominal)} → ${rp(nominal)}.`];
}

async function cmdMasuk(db: Db, nomor: string, nominal: number | null, now: Date): Promise<string[]> {
  if (!nominal) return ["Berapa yang masuk? Contoh: `masuk 300` atau `masuk 250rb`."];
  try {
    const { period, result } = await proposePeriod(db, nominal, now);
    await setPending(db, nomor, { jenis: "masuk", periodId: period.id, result }, now);
    return [usulanPeriode(period, result)];
  } catch (e) {
    if (e instanceof AppError && e.code === "period_exists") {
      await setPending(db, nomor, { jenis: "bonus", nominal }, now);
      return [`Periode minggu ini udah jalan, jadi ${rp(nominal)} ini gw anggap uang ekstra.\nDefault: 50% Tabungan kado, 50% Darurat — balas "ok". Atau pilih satu amplop:\n${pilihanBernomor(PILIHAN_BONUS)}\nBalas angkanya, atau "batal".`];
    }
    throw e;
  }
}

async function konfirmasiMasuk(db: Db, nomor: string, periodId: number, now: Date): Promise<string[]> {
  await clearPending(db, nomor);
  let hasil: Awaited<ReturnType<typeof confirmPeriodAndNotify>>;
  try {
    hasil = await confirmPeriodAndNotify(db, periodId, now);
  } catch (e) {
    if (e instanceof AppError && e.code === "not_found") return ["Usulan itu udah dikonfirmasi atau dibatalin (mungkin dari website). Cek `sisa`."];
    throw e;
  }
  const { period, sisaMakanPindah } = hasil;
  const daily = await getDailyStatus(db, now);
  const baris = [`Sip, periode ${fmtTanggal(period.tanggalMulai)}–${fmtTanggal(period.tanggalSelesai)} resmi jalan.`];
  if (sisaMakanPindah > 0) baris.push(`Sisa makan minggu lalu ${rp(sisaMakanPindah)} udah pindah ke Darurat.`);
  if (daily) baris.push(statusJatah(daily));
  const bill = await nextPaylaterBill(db);
  if (bill && bill.jatuhTempo <= addDays(wibDate(now), 3)) baris.push(`Ingat: ${bill.nama} ${rp(bill.nominal)} jatuh tempo ${fmtTanggal(bill.jatuhTempo)}. Kalau udah bayar, balas \`bayar paylater\`.`);
  return [baris.join("\n")];
}

async function terapkanBonus(db: Db, nomor: string, nominal: number, kode: EnvelopeKode | null): Promise<string[]> {
  const period = await getCurrentPeriod(db);
  if (!period) return [BELUM_ADA_PERIODE];
  let bagian: Partial<Record<EnvelopeKode, number>>;
  if (kode) bagian = { [kode]: nominal };
  else {
    const alloc = await getPeriodAllocations(db, period.id);
    const keKado = alloc.kado > 0 ? Math.floor(nominal / 2) : 0;
    bagian = { kado: keKado, darurat: nominal - keKado };
  }
  await addBonus(db, period.id, bagian);
  await clearPending(db, nomor);
  const ket = (Object.entries(bagian) as [EnvelopeKode, number][])
    .filter(([, n]) => n)
    .map(([k, n]) => `${NAMA_PENDEK[k]} +${rp(n)}`)
    .join(", ");
  return [`Uang ekstra ${rp(nominal)} masuk: ${ket}.`];
}

async function cmdBayarPaylater(db: Db, nominal: number | null, raw: string, now: Date): Promise<string[]> {
  const bill = await nextPaylaterBill(db, nominal);
  if (!bill) return ["Nggak ada tagihan paylater yang belum lunas. Tambah tagihan baru di website (menu Tagihan)."];
  const r = await payBill(db, bill.id, { nominal: nominal ?? undefined, now, sumber: "wa", pesanAsli: raw });
  const baris = [`Lunas: ${bill.nama} ${fmtTanggal(bill.jatuhTempo)} dibayar ${rp(r.dibayar)}.`];
  if (nominal && nominal !== bill.nominal) baris.push(`(Perkiraan tadinya ${rp(bill.nominal)}, udah gw sesuaikan.)`);
  if (r.saldoSetelah !== null) baris.push(r.saldoSetelah >= 0 ? `Sisa amplop Paylater ${rp(r.saldoSetelah)}.` : `Amplop Paylater minus ${rp(-r.saldoSetelah)}. Tutup pakai \`pindah ${Math.ceil(-r.saldoSetelah / 1000)}k darurat ke paylater alasan nutup tagihan\`.`);
  if (r.terlambatHari > 0) baris.push(`Telat ${r.terlambatHari} hari. Next time gw ingetin H-3 & H-1 ya.`);
  const next = await nextPaylaterBill(db);
  if (next) baris.push(`Tagihan berikutnya: ${rp(next.nominal)} tanggal ${fmtTanggal(next.jatuhTempo)}${next.tanggalPasti ? "" : " (perkiraan)"}.`);
  return [baris.join("\n")];
}

// ---------------------------------------------------------------- pindah amplop

async function cmdPindah(db: Db, nomor: string, p: Extract<ParsedMessage, { type: "pindah" }>, now: Date): Promise<string[]> {
  if (!p.nominal || !p.dari || !p.ke) {
    return ["Format: `pindah 10k darurat ke makan alasan kurang lauk`.\nNama amplop: makan, data, paylater, kado, darurat."];
  }
  if (!p.alasan) {
    await setPending(db, nomor, { jenis: "pindah_alasan", dari: p.dari, ke: p.ke, nominal: p.nominal }, now);
    return [`Pindah ${rp(p.nominal)} dari ${NAMA_PENDEK[p.dari]} ke ${NAMA_PENDEK[p.ke]}. Alasannya apa? (biar tercatat)`];
  }
  return mulaiPindah(db, nomor, p.dari, p.ke, p.nominal, p.alasan, now);
}

async function mulaiPindah(db: Db, nomor: string, dari: EnvelopeKode, ke: EnvelopeKode, nominal: number, alasan: string, now: Date): Promise<string[]> {
  const env = await db.envelope.findUnique({ where: { kode: dari } });
  if (env?.terkunci) {
    await setPending(db, nomor, { jenis: "pindah_kado", dari, ke, nominal, alasan }, now);
    return [`${env.nama} itu terkunci buat kado. Kalau diambil ${rp(nominal)}, target mundur segitu.\nKetik *${KATA_BUKA_KUNCI}* buat lanjut, atau "batal".`];
  }
  return jalankanPindah(db, dari, ke, nominal, alasan, now);
}

async function jalankanPindah(db: Db, dari: EnvelopeKode, ke: EnvelopeKode, nominal: number, alasan: string, now: Date, konfirmasi?: string): Promise<string[]> {
  const r = await transferBetween(db, { dari, ke, nominal, alasan, now, sumber: "wa", konfirmasiBukaKunci: konfirmasi });
  const baris = [`Pindah ${rp(nominal)}: ${r.namaDari} → ${r.namaKe} (${alasan}).`, `${NAMA_PENDEK[dari]} ${rp(r.saldoDari)} · ${NAMA_PENDEK[ke]} ${rp(r.saldoKe)}.`];
  if (ke === "makan") {
    const d = await getDailyStatus(db, now);
    if (d) baris.push(`Jatah hari ini jadi ${rp(d.jatahHariIni)}.`);
  }
  return [baris.join("\n")];
}

// ---------------------------------------------------------------- tahan belanja

async function cmdMauBeli(db: Db, nomor: string, barang: string, nominal: number | null, raw: string, now: Date): Promise<string[]> {
  if (!nominal) return [`Harganya berapa? Contoh: \`mau beli ${barang} 150k\`.`];
  return tawarkanTahan(db, nomor, barang, nominal, raw, now);
}

async function tawarkanTahan(db: Db, nomor: string, barang: string, nominal: number, raw: string, now: Date): Promise<string[]> {
  if (!(await getCurrentPeriod(db))) return [BELUM_ADA_PERIODE];
  const i = await analyzePurchase(db, nominal, now);
  const baris = [`*Tahan dulu.* ${barang} ${rp(nominal)} = ${String(i.hariMakan).replace(".", ",")} hari jatah makan.`];
  if (i.sisaSumber >= 0) baris.push(`Darurat sekarang ${rp(i.saldoSumber)}, sisa ${rp(i.sisaSumber)} kalau jadi beli.`);
  else baris.push(`Darurat cuma ${rp(i.saldoSumber)}. Kurangnya ${rp(i.kadoMundur)} bakal bikin tabungan kado mundur segitu.`);
  baris.push("", "1. Tunda 24 jam (disarankan)", "2. Beli sekarang (catat ke Darurat)", "3. Gak jadi");
  await setPending(db, nomor, { jenis: "tahan", barang, nominal, raw }, now);
  return [baris.join("\n")];
}

async function putuskanTahan(db: Db, id: number, keputusan: "beli" | "batal", now: Date): Promise<string[]> {
  const { hold, saldoSetelah } = await decideHold(db, id, keputusan, now, "wa");
  if (keputusan === "batal") return [`Mantap! ${hold.barang} nggak jadi dibeli, ${rp(hold.nominal)} diselamatkan.`];
  return [`Oke, ${hold.barang} ${rp(hold.nominal)} dicatat ke Darurat. Sisa Darurat ${rp(saldoSetelah ?? 0)}.`];
}

// ---------------------------------------------------------------- catat pengeluaran

async function catat(db: Db, nomor: string, items: ExpenseItem[], raw: string, now: Date, tanggal?: string): Promise<string[]> {
  if (items.some((i) => i.kode === null)) {
    await setPending(db, nomor, { jenis: "kategori", items, raw, tanggal }, now);
    return [pertanyaanKategori(items)];
  }
  return simpanAtauTahan(db, nomor, items, raw, now, tanggal);
}

/** Pembelian non-rutin (satu item Darurat di atas batas) masuk mode tahan belanja dulu. */
async function simpanAtauTahan(db: Db, nomor: string, items: ExpenseItem[], raw: string, now: Date, tanggal?: string): Promise<string[]> {
  if (!tanggal && items.length === 1 && items[0].kode === "darurat") {
    const batas = await getSettingNumber(db, "batas_tahan");
    if (batas > 0 && items[0].nominal >= batas) return tawarkanTahan(db, nomor, items[0].nama, items[0].nominal, raw, now);
  }
  return simpanItems(db, items, raw, now, tanggal);
}

function pertanyaanKategori(items: ExpenseItem[]): string {
  const item = items.find((i) => i.kode === null)!;
  return `"${item.nama}" ${rp(item.nominal)} masuk amplop mana?\n${pilihanBernomor(PILIHAN_KATEGORI)}\nBalas angkanya, atau "batal".`;
}

async function lanjutKategori(db: Db, nomor: string, p: Extract<Pending, { jenis: "kategori" }>, kode: EnvelopeKode, now: Date): Promise<string[]> {
  const items = p.items.map((i) => ({ ...i }));
  items.find((i) => i.kode === null)!.kode = kode;
  if (items.some((i) => i.kode === null)) {
    await setPending(db, nomor, { ...p, items }, now);
    return [pertanyaanKategori(items)];
  }
  await clearPending(db, nomor);
  return simpanAtauTahan(db, nomor, items, p.raw, now, p.tanggal);
}

async function simpanItems(db: Db, items: ExpenseItem[], raw: string, now: Date, tanggal?: string): Promise<string[]> {
  const saved: { item: ExpenseItem; kode: EnvelopeKode; melewati: boolean }[] = [];
  for (const item of items) {
    const kode = item.kode as EnvelopeKode;
    const r = await recordExpense(db, { kode, nominal: item.nominal, catatan: item.nama, sumber: "wa", pesanAsli: raw, now, tanggal });
    saved.push({ item, kode, melewati: r.melewatiBatas20 });
  }

  const period = await getCurrentPeriod(db);
  const balances = await getBalances(db, period!.id);
  const baris: string[] = [];
  const perAmplop = ENVELOPE_KODE.filter((k) => saved.some((s) => s.kode === k));
  const kapan = tanggal ? ` (tanggal ${fmtTanggal(tanggal)})` : "";

  for (const kode of perAmplop) {
    const group = saved.filter((s) => s.kode === kode);
    const total = group.reduce((s, g) => s + g.item.nominal, 0);
    if (group.length === 1) baris.push(`Oke, ${group[0].item.nama} ${rp(total)} masuk ke ${NAMA_PENDEK[kode]}${kapan}.`);
    else {
      baris.push(`Oke, ${group.length} catatan masuk ke ${NAMA_PENDEK[kode]} (${rp(total)})${kapan}:`);
      for (const g of group) baris.push(`• ${g.item.nama} ${rp(g.item.nominal)}`);
    }
  }

  for (const kode of perAmplop) {
    if (kode === "makan") {
      const daily = await getDailyStatus(db, now);
      if (daily) baris.push(statusJatah(daily));
    } else {
      const b = balances.find((x) => x.kode === kode)!;
      baris.push(`Sisa ${NAMA_PENDEK[kode]}: ${rp(b.saldo)}${b.kumulatif ? "" : ` dari ${rp(b.alokasi)}`}.`);
    }
    if (saved.some((s) => s.kode === kode && s.melewati)) {
      const b = balances.find((x) => x.kode === kode)!;
      baris.push(`Peringatan: ${NAMA_PENDEK[kode]} tinggal ${rp(b.saldo)}, udah di bawah 20% jatah minggu ini.`);
    }
  }

  const asumsi = saved.filter((s) => s.item.assumedThousand).map((s) => `${s.item.nominal / 1000} → ${rp(s.item.nominal)}`);
  if (asumsi.length) baris.push(`(Angka tanpa satuan dianggap ribuan: ${asumsi.join(", ")}. Salah? Ketik \`ubah <nominal>\`.)`);
  return [baris.join("\n")];
}
