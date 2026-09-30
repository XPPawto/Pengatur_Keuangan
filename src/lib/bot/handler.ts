import type { Db } from "../db";
import { rp } from "../money";
import { AppError } from "../services/errors";
import { mergeDictionary, DEFAULT_DICTIONARY, type CategoryDictionary } from "../parser/category";
import { parseMessage, type ExpenseItem } from "../parser/message";
import { getBalances } from "../services/envelopes";
import { getDailyStatus, getStreak, markTanpaJajan } from "../services/daily";
import {
  addBonus,
  cancelPendingPeriod,
  confirmPeriod,
  getCurrentPeriod,
  getPeriodAllocations,
  proposePeriod,
} from "../services/periods";
import { deleteTransaction, lastTransaction, listTransactions, recordExpense } from "../services/transactions";
import { fmtTanggal, wibDate } from "../time";
import { ENVELOPE_KODE, type EnvelopeKode } from "../types";
import { isOwner, normalizePhone } from "../whitelist";
import {
  BANTUAN,
  BELUM_ADA_FITUR,
  BELUM_ADA_PERIODE,
  NAMA_PENDEK,
  TAK_PAHAM,
  hariIniList,
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
  | { jenis: "kategori"; items: ExpenseItem[]; raw: string };

const PENDING_TTL_MS: Record<Pending["jenis"], number> = {
  masuk: 12 * 3600_000,
  bonus: 2 * 3600_000,
  batal: 30 * 60_000,
  kategori: 30 * 60_000,
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

async function getPending(db: Db, nomor: string, now: Date): Promise<(Pending & { id: number }) | null> {
  await db.pendingAction.deleteMany({ where: { kedaluwarsa: { lt: now } } });
  const row = await db.pendingAction.findFirst({ where: { nomor }, orderBy: { id: "desc" } });
  if (!row) return null;
  return { id: row.id, ...(JSON.parse(row.payload) as Pending), jenis: row.jenis as Pending["jenis"] } as Pending & { id: number };
}

async function setPending(db: Db, nomor: string, p: Pending, now: Date) {
  await db.pendingAction.deleteMany({ where: { nomor } });
  const { jenis, ...payload } = p;
  await db.pendingAction.create({
    data: { nomor, jenis, payload: JSON.stringify({ ...payload, jenis }), kedaluwarsa: new Date(now.getTime() + PENDING_TTL_MS[jenis]) },
  });
}

async function clearPending(db: Db, nomor: string) {
  await db.pendingAction.deleteMany({ where: { nomor } });
}

/** Titik masuk bot: pesan masuk → daftar balasan. Semua logika ada di service layer. */
export async function handleMessage(db: Db, msg: IncomingMessage): Promise<string[]> {
  const nomor = normalizePhone(msg.nomor);
  const now = msg.now;

  if (!isOwner(nomor)) {
    await db.messageLog.create({ data: { arah: "masuk", nomor, isi: "[diabaikan: nomor tidak terdaftar]", waktu: now } });
    return [];
  }
  await db.messageLog.create({ data: { arah: "masuk", nomor, isi: msg.text, waktu: now } });

  let replies: string[];
  try {
    replies = await proses(db, nomor, msg.text, now);
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

  // --- jawaban untuk percakapan yang lagi menunggu ---
  if (pending) {
    const batalin = parsed.type === "tidak" || parsed.type === "batal";
    switch (pending.jenis) {
      case "masuk":
        if (parsed.type === "ok") return konfirmasiMasuk(db, nomor, pending.periodId, now);
        if (batalin) {
          await cancelPendingPeriod(db, pending.periodId);
          await clearPending(db, nomor);
          return ["Oke, uang masuk dibatalin. Balas `masuk <nominal>` kalau mau ulang."];
        }
        break;
      case "bonus":
        if (parsed.type === "ok") return terapkanBonus(db, nomor, pending.nominal, null);
        if (parsed.type === "pilihan" && parsed.n <= PILIHAN_BONUS.length)
          return terapkanBonus(db, nomor, pending.nominal, PILIHAN_BONUS[parsed.n - 1]);
        if (batalin) {
          await clearPending(db, nomor);
          return ["Oke, uang ekstra nggak dicatat."];
        }
        break;
      case "batal":
        if (parsed.type === "ok") {
          await clearPending(db, nomor);
          const tx = await deleteTransaction(db, pending.txId, now).catch(() => null);
          return [tx ? `Kehapus: ${tx.catatan || "(tanpa catatan)"} ${rp(tx.nominal)}.` : "Catatan itu udah nggak ada."];
        }
        if (batalin) {
          await clearPending(db, nomor);
          return ["Oke, nggak jadi dihapus."];
        }
        break;
      case "kategori":
        if (parsed.type === "pilihan" && parsed.n <= PILIHAN_KATEGORI.length)
          return lanjutKategori(db, nomor, pending, PILIHAN_KATEGORI[parsed.n - 1], now);
        if (batalin) {
          await clearPending(db, nomor);
          return ["Oke, nggak jadi dicatat."];
        }
        break;
    }
    // pesan lain = mulai urusan baru, percakapan lama dibuang
    if (parsed.type !== "ok" && parsed.type !== "pilihan") await clearPending(db, nomor);
  }

  switch (parsed.type) {
    case "bantuan":
      return [BANTUAN];
    case "sisa":
      return cmdSisa(db, now);
    case "hari_ini":
      return cmdHariIni(db, now);
    case "nol":
      return cmdNol(db, now);
    case "batal":
      return cmdBatal(db, nomor, now);
    case "masuk":
      return cmdMasuk(db, nomor, parsed.nominal, now);
    case "expense":
      return catat(db, nomor, parsed.items, text, now);
    case "ok":
    case "tidak":
    case "pilihan":
    case "yakin_ambil":
      return ["Nggak ada yang lagi nunggu konfirmasi. Ketik `bantuan` kalau butuh contoh."];
    case "target":
    case "belanja":
    case "menu":
    case "bayar_paylater":
    case "pindah":
    case "mau_beli":
      return [BELUM_ADA_FITUR];
    default:
      return [/^[a-z\s]+$/i.test(text.trim()) ? `Nominalnya berapa? Contoh: \`${text.trim()} 5k\`` : TAK_PAHAM];
  }
}

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
  return [`Oke, hari ini dicatat nggak jajan. Streak disiplin ${streak} hari 🔥`];
}

async function cmdBatal(db: Db, nomor: string, now: Date): Promise<string[]> {
  const tx = await lastTransaction(db);
  if (!tx) return ["Belum ada catatan yang bisa dibatalin."];
  await setPending(db, nomor, { jenis: "batal", txId: tx.id }, now);
  return [`Hapus catatan terakhir: ${tx.catatan || "(tanpa catatan)"} ${rp(tx.nominal)} [${NAMA_PENDEK[tx.envelope.kode as EnvelopeKode]}], ${fmtTanggal(tx.tanggal)}?\nBalas "ok" buat hapus, atau "batal".`];
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
      const daftar = PILIHAN_BONUS.map((k, i) => `${i + 1}. ${NAMA_PENDEK[k]}`).join("\n");
      return [`Periode minggu ini udah jalan, jadi ${rp(nominal)} ini gw anggap uang ekstra.\nDefault: 50% Tabungan kado, 50% Darurat — balas "ok". Atau pilih satu amplop:\n${daftar}\nBalas angkanya, atau "batal".`];
    }
    throw e;
  }
}

async function konfirmasiMasuk(db: Db, nomor: string, periodId: number, now: Date): Promise<string[]> {
  const { period, sisaMakanPindah } = await confirmPeriod(db, periodId, now);
  await clearPending(db, nomor);
  const daily = await getDailyStatus(db, now);
  const baris = [`Sip, periode ${fmtTanggal(period.tanggalMulai)}–${fmtTanggal(period.tanggalSelesai)} resmi jalan.`];
  if (sisaMakanPindah > 0) baris.push(`Sisa makan minggu lalu ${rp(sisaMakanPindah)} udah pindah ke Darurat.`);
  if (daily) baris.push(statusJatah(daily));
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

async function catat(db: Db, nomor: string, items: ExpenseItem[], raw: string, now: Date): Promise<string[]> {
  if (items.some((i) => i.kode === null)) {
    await setPending(db, nomor, { jenis: "kategori", items, raw }, now);
    return [pertanyaanKategori(items)];
  }
  return simpanItems(db, items, raw, now);
}

function pertanyaanKategori(items: ExpenseItem[]): string {
  const item = items.find((i) => i.kode === null)!;
  const daftar = PILIHAN_KATEGORI.map((k, i) => `${i + 1}. ${NAMA_PENDEK[k]}`).join("\n");
  return `"${item.nama}" ${rp(item.nominal)} masuk amplop mana?\n${daftar}\nBalas angkanya, atau "batal".`;
}

async function lanjutKategori(db: Db, nomor: string, p: Extract<Pending, { jenis: "kategori" }>, kode: EnvelopeKode, now: Date): Promise<string[]> {
  const items = p.items.map((i) => ({ ...i }));
  const target = items.find((i) => i.kode === null)!;
  target.kode = kode;
  if (items.some((i) => i.kode === null)) {
    await setPending(db, nomor, { jenis: "kategori", items, raw: p.raw }, now);
    return [pertanyaanKategori(items)];
  }
  await clearPending(db, nomor);
  return simpanItems(db, items, p.raw, now);
}

async function simpanItems(db: Db, items: ExpenseItem[], raw: string, now: Date): Promise<string[]> {
  const saved: { item: ExpenseItem; kode: EnvelopeKode; melewati: boolean }[] = [];
  for (const item of items) {
    const kode = item.kode as EnvelopeKode;
    const r = await recordExpense(db, { kode, nominal: item.nominal, catatan: item.nama, sumber: "wa", pesanAsli: raw, now });
    saved.push({ item, kode, melewati: r.melewatiBatas20 });
  }

  const period = await getCurrentPeriod(db);
  const balances = await getBalances(db, period!.id);
  const baris: string[] = [];

  const perAmplop = ENVELOPE_KODE.filter((k) => saved.some((s) => s.kode === k));
  for (const kode of perAmplop) {
    const group = saved.filter((s) => s.kode === kode);
    const total = group.reduce((s, g) => s + g.item.nominal, 0);
    if (group.length === 1) baris.push(`Oke, ${group[0].item.nama} ${rp(total)} masuk ke ${NAMA_PENDEK[kode]}.`);
    else {
      baris.push(`Oke, ${group.length} catatan masuk ke ${NAMA_PENDEK[kode]} (${rp(total)}):`);
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
      baris.push(`⚠️ ${NAMA_PENDEK[kode]} tinggal ${rp(b.saldo)}, udah di bawah 20% jatah minggu ini.`);
    }
  }

  const asumsi = saved.filter((s) => s.item.assumedThousand).map((s) => `${s.item.nominal / 1000} → ${rp(s.item.nominal)}`);
  if (asumsi.length) baris.push(`(Angka tanpa satuan dianggap ribuan: ${asumsi.join(", ")}. Salah? Ketik \`batal\`.)`);
  return [baris.join("\n")];
}
