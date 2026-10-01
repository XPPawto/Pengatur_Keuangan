import type { Db } from "../db";
import { rp } from "../money";
import { AppError } from "../services/errors";
import { mergeDictionary, DEFAULT_DICTIONARY, detectCategory, type CategoryDictionary } from "../parser/category";
import { kalimatBebas, parseMessage, type ExpenseItem, type ParsedMessage } from "../parser/message";
import { getBalances } from "../services/envelopes";
import { getDailyStatus, getStreak, markTanpaJajan } from "../services/daily";
import { cancelPendingPeriod, getCurrentPeriod, proposePeriod, setPemasukan } from "../services/periods";
import { lastTransaction, listTransactions, recordExpense, updateTransaction } from "../services/transactions";
import { confirmPeriodAndNotify } from "../services/notify";
import { nextPaylaterBill, payBill, billsWithReadiness } from "../services/bills";
import { transferBetween } from "../services/transfers";
import { analyzePurchase, createHold, decideHold, latestAskedHold } from "../services/holds";
import { getGoalProgress } from "../services/goals";
import { getShoppingWeek } from "../services/shopping";
import { getSetting, getSettingNumber } from "../services/settings";
import { peranNomor } from "../services/recipients";
import { logActivity, type Actor } from "../services/activity-log";
import { lastUndoable, listActivities, undoActivity } from "../services/undo";
import { catatKiriman, namaPengirim, ringkasBagian, usulanBagi, type Bagian } from "../services/extra";
import { mulaiRekonsiliasi, selesaikanRekonsiliasi } from "../services/reconcile";
import { deteksiPola, jalankanSaran, proyeksi, saranMingguan, simulasi, type SaranTransfer } from "../services/autopilot";
import { getPrestasi, rekapLengkap, teksSkor } from "../services/game";
import { bayarDebt, createDebt, patungan, ringkasanDebt } from "../services/debts";
import { cekLonjakan } from "../services/prices";
import { parseStruk, type HasilStruk } from "../ocr/struk";
import { addDays, fmtTanggal, fmtTanggalPanjang, wibDate, wibHM } from "../time";
import { ajariKata, bacaFotoAI, hapusRiwayat, ingat, jalankanAksiAI, lagiNgobrol, lupakan, pesanAIMati, tanyaAsisten, tebakKategoriAI, teksUsulan, type AksiAI } from "../ai/asisten";
import { statusAI } from "../ai/panggil";
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
  /** pemuat gambar kalau pesannya foto (struk) */
  gambar?: () => Promise<Buffer>;
  /** pembaca teks gambar (OCR); bisa diganti saat tes */
  ocr?: (gambar: Buffer) => Promise<string>;
  /** tampilkan status "mengetik…" di WhatsApp (hanya untuk pemilik) */
  mengetik?: () => void;
}

/** Pilihan amplop saat kategori tidak jelas (Tabungan kado & Paylater sengaja tidak ditawarkan). */
const PILIHAN_KATEGORI: EnvelopeKode[] = ["makan", "data", "darurat"];
const PILIHAN_BONUS: EnvelopeKode[] = ["makan", "data", "paylater", "kado", "darurat"];

type Pending =
  | { jenis: "masuk"; periodId: number; result: Parameters<typeof usulanPeriode>[1] }
  | { jenis: "kiriman"; dari: string; nominal: number; bagian: Bagian }
  | { jenis: "undo"; id: number }
  | { jenis: "kategori"; items: ExpenseItem[]; raw: string; tanggal?: string; saran?: { kode: EnvelopeKode; kata: string } }
  | { jenis: "tahan"; barang: string; nominal: number; raw: string }
  | { jenis: "pindah_kado"; dari: EnvelopeKode; ke: EnvelopeKode; nominal: number; alasan: string }
  | { jenis: "pindah_alasan"; dari: EnvelopeKode; ke: EnvelopeKode; nominal: number }
  | { jenis: "struk"; hasil: HasilStruk; kode: EnvelopeKode; kodeItem?: EnvelopeKode[]; tanggal?: string }
  | { jenis: "saran"; transfers: SaranTransfer[] }
  | { jenis: "rekon"; recId: number; selisih: number }
  | { jenis: "ai"; aksi: AksiAI[] };

const PENDING_TTL_MS: Record<Pending["jenis"], number> = {
  masuk: 12 * 3600_000,
  kiriman: 6 * 3600_000,
  undo: 30 * 60_000,
  kategori: 30 * 60_000,
  tahan: 60 * 60_000,
  pindah_kado: 15 * 60_000,
  pindah_alasan: 15 * 60_000,
  struk: 60 * 60_000,
  saran: 12 * 3600_000,
  rekon: 60 * 60_000,
  ai: 2 * 3600_000,
};

const aktor = (nomor: string): Actor => ({ oleh: nomor, sumber: "wa" });

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
  for (const k of await db.kataKategori.findMany()) {
    const kode = k.envelopeKode as EnvelopeKode;
    extra[kode] = [...(extra[kode] ?? []), k.kata];
  }
  return mergeDictionary(DEFAULT_DICTIONARY, extra);
}

async function getPending(db: Db, nomor: string, now: Date): Promise<Pending | null> {
  await db.pendingAction.deleteMany({ where: { kedaluwarsa: { lt: now } } });
  const row = await db.pendingAction.findFirst({ where: { nomor }, orderBy: { id: "desc" } });
  if (!row) return null;
  return { ...(JSON.parse(row.payload) as object), jenis: row.jenis } as Pending;
}

export async function setPending(db: Db, nomor: string, p: Pending, now: Date) {
  await db.pendingAction.deleteMany({ where: { nomor } });
  await db.pendingAction.create({
    data: { nomor, jenis: p.jenis, payload: JSON.stringify(p), kedaluwarsa: new Date(now.getTime() + PENDING_TTL_MS[p.jenis]) },
  });
}

async function clearPending(db: Db, nomor: string) {
  await db.pendingAction.deleteMany({ where: { nomor } });
}

/** Titik masuk bot: pesan masuk → daftar balasan. Semua logika ada di service layer. */
/** Pesan lebih panjang dari ini dipotong (mencegah pesan raksasa menghabiskan memori / kuota AI). */
const MAKS_PESAN = 4000;

export async function handleMessage(db: Db, masukan: IncomingMessage): Promise<string[]> {
  const msg = { ...masukan, text: (masukan.text ?? "").slice(0, MAKS_PESAN) };
  const nomor = normalizePhone(msg.nomor);
  const now = msg.now;
  const peran = await peranNomor(db, nomor);

  if (!peran) {
    await db.messageLog.create({ data: { arah: "masuk", nomor, isi: "[diabaikan: nomor tidak terdaftar]", waktu: now } });
    return [];
  }
  await db.messageLog.create({ data: { arah: "masuk", nomor, isi: msg.gambar ? `[gambar] ${msg.text}` : msg.text, waktu: now } });

  if (peran === "pemilik") msg.mengetik?.();
  let replies: string[];
  try {
    if (peran === "keluarga") replies = await prosesKeluarga(db, nomor, msg.text, now);
    else if (msg.gambar) replies = await prosesGambar(db, nomor, msg, now);
    else replies = await proses(db, nomor, msg.text, now);
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

  // Asisten AI: pertanyaan, permintaan, cerita bebas, atau lanjutan obrolan
  let catatanAI: string | null = null;
  if (parsed.type === "tanya") return cmdTanya(db, nomor, parsed.pertanyaan, now);
  const arah = await keAsisten(db, nomor, text, parsed, pending?.jenis === "ai", now);
  if (arah.ya) {
    const r = await tanyaAsisten(db, { kanal: nomor, pesan: text, now });
    if (r.ok) return balasAsisten(db, nomor, r, now);
    catatanAI = pesanAIMati(r.alasan);
  } else if (arah.catatan) catatanAI = arah.catatan;

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
      return cmdNol(db, nomor, now);
    case "batal":
      return cmdUndo(db, nomor, now);
    case "aktivitas":
      return cmdAktivitas(db);
    case "ubah":
      return cmdUbah(db, nomor, parsed.nominal, now);
    case "masuk":
      return cmdMasuk(db, nomor, parsed.nominal, now);
    case "koreksi_masuk":
      return cmdKoreksiMasuk(db, nomor, parsed.nominal, now);
    case "kiriman":
      return cmdKiriman(db, nomor, parsed.dari, parsed.nominal, now);
    case "expense": {
      const r = await catat(db, nomor, parsed.items, text, now, parsed.kemarin ? addDays(wibDate(now), -1) : undefined);
      return catatanAI ? [`${catatanAI}\nGw baca pakai cara biasa ya:\n\n${r.join("\n\n")}`] : r;
    }
    case "bayar_paylater":
      return cmdBayarPaylater(db, nomor, parsed.nominal, text, now);
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
    case "rekon":
      return cmdRekon(db, nomor, parsed.nominal, now);
    case "proyeksi":
      return cmdProyeksi(db, now);
    case "kalau_beli":
      return cmdKalauBeli(db, parsed.barang, parsed.nominal, now);
    case "kalau_masuk":
      return cmdKalauMasuk(db, parsed.nominal, parsed.minggu, now);
    case "saran":
      return cmdSaran(db, nomor, now);
    case "pola":
      return cmdPola(db, now);
    case "skor":
      return [teksSkor(await getPrestasi(db, now))];
    case "ingat":
      return cmdIngat(db, parsed.isi);
    case "lupakan": {
      const r = await lupakan(db, parsed.id);
      return [r ? `Oke, udah gw lupain: "${r.isi}".` : `Memori nomor ${parsed.id} nggak ada. Ketik \`memori\` buat lihat daftarnya.`];
    }
    case "memori":
      return cmdMemori(db);
    case "reset_obrolan":
      await hapusRiwayat(db, nomor);
      return ["Oke, obrolan sama asisten dimulai dari nol. Memori jangka panjang tetap aman (`memori`)."];
    case "hutang_list":
      return cmdHutang(db, now);
    case "piutang_baru":
    case "hutang_baru":
      return cmdHutangBaru(db, nomor, parsed.type === "piutang_baru" ? "piutang" : "hutang", parsed.orang, parsed.nominal, now);
    case "piutang_bayar":
    case "hutang_bayar":
      return cmdHutangBayar(db, nomor, parsed.type === "piutang_bayar" ? "piutang" : "hutang", parsed.orang, parsed.nominal, now);
    case "patungan":
      return cmdPatungan(db, nomor, parsed.barang, parsed.nominal, parsed.orang, now);
    case "beli":
    case "tidak": {
      const h = await latestAskedHold(db);
      if (h) return putuskanTahan(db, nomor, h.id, parsed.type === "beli" ? "beli" : "batal", now);
      return ["Nggak ada yang lagi nunggu konfirmasi. Ketik `bantuan` kalau butuh contoh."];
    }
    case "ok":
    case "pilihan":
    case "yakin_ambil":
    case "rinci":
    case "abaikan":
      return ["Nggak ada yang lagi nunggu konfirmasi. Ketik `bantuan` kalau butuh contoh."];
    default:
      if (catatanAI) return [`${catatanAI}\nSementara pakai perintah biasa dulu: \`tempe 5k\`, \`sisa\`, \`rekap\`, atau \`bantuan\`.`];
      return [/^[a-z\s]+$/i.test(text.trim()) && text.trim().split(/\s+/).length <= 2 ? `Nominalnya berapa? Contoh: \`${text.trim()} 5k\`` : TAK_PAHAM];
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
    case "kiriman": {
      let bagian: Bagian | null = null;
      if (parsed.type === "ok") bagian = p.bagian;
      else if (parsed.type === "pilihan" && parsed.n <= PILIHAN_BONUS.length) bagian = { [PILIHAN_BONUS[parsed.n - 1]]: p.nominal };
      else if (batalin) return selesai([`Oke, kiriman ${p.dari} nggak dicatat.`]);
      if (!bagian) return null;
      await clearPending(db, nomor);
      const r = await catatKiriman(db, { dari: p.dari, nominal: p.nominal, bagian, actor: aktor(nomor), now });
      const baris = [`Kiriman ${p.dari} ${rp(p.nominal)} tercatat: ${ringkasBagian(r.bagian)}.`];
      const keluarga = await db.outbox.count({ where: { kunci: { startsWith: `kiriman:${r.kiriman.id}:` } } });
      if (keluarga) baris.push(`Tanda terima udah gw kirim ke ${p.dari === "Ayah" || p.dari === "Ibu" ? p.dari : "keluarga"}.`);
      const d = await getDailyStatus(db, now);
      if (d && r.bagian.makan) baris.push(statusJatah(d));
      return baris;
    }
    case "undo":
      if (parsed.type === "ok") {
        await clearPending(db, nomor);
        const log = await undoActivity(db, p.id, aktor(nomor), now);
        return [`Dibatalkan: ${log.ringkasan}.`];
      }
      if (batalin) return selesai(["Oke, nggak jadi dibatalin."]);
      return null;
    case "kategori":
      if (parsed.type === "pilihan" && parsed.n <= PILIHAN_KATEGORI.length) return lanjutKategori(db, nomor, p, PILIHAN_KATEGORI[parsed.n - 1], now);
      if (parsed.type === "ok" && p.saran) return lanjutKategori(db, nomor, p, p.saran.kode, now);
      if (batalin) return selesai(["Oke, nggak jadi dicatat."]);
      return null;
    case "ai": {
      if (batalin) return selesai(["Oke, usulannya gw buang."]);
      const sebagian = /^(?:ok|oke|sip|gas|ya|iya|yes)\s+([\d\s,dan]+)$/i.exec(text.trim());
      let pilih: AksiAI[] | null = null;
      if (parsed.type === "ok") pilih = p.aksi;
      else if (parsed.type === "pilihan" && parsed.n <= p.aksi.length) pilih = [p.aksi[parsed.n - 1]];
      else if (sebagian) {
        const no = [...new Set((sebagian[1].match(/\d+/g) ?? []).map(Number))].filter((n) => n >= 1 && n <= p.aksi.length);
        if (no.length) pilih = no.map((n) => p.aksi[n - 1]);
      }
      if (!pilih) return null;
      await clearPending(db, nomor);
      return jalankanUsulan(db, nomor, pilih, now);
    }
    case "tahan":
      if (parsed.type === "ok" || (parsed.type === "pilihan" && parsed.n === 1)) {
        const h = await createHold(db, { barang: p.barang, nominal: p.nominal, nomor, now });
        await logActivity(db, aktor(nomor), "tahan_belanja", `Tahan beli ${p.barang} ${rp(p.nominal)} 24 jam`, { now });
        const { jam, menit } = wibHM(h.tanyaUlangPada);
        return selesai([`Sip, ditahan dulu. Besok jam ${String(jam).padStart(2, "0")}.${String(menit).padStart(2, "0")} gw tanya lagi masih mau atau nggak.`]);
      }
      if ((parsed.type === "pilihan" && parsed.n === 2) || parsed.type === "beli") {
        await clearPending(db, nomor);
        return simpanItems(db, nomor, [{ nama: p.barang, nominal: p.nominal, assumedThousand: false, kode: "darurat" }], p.raw, now);
      }
      if ((parsed.type === "pilihan" && parsed.n === 3) || batalin) {
        const h = await createHold(db, { barang: p.barang, nominal: p.nominal, nomor, now });
        await decideHold(db, h.id, "batal", now, "wa", aktor(nomor));
        return selesai([`Mantap, ${rp(p.nominal)} diselamatkan. Tercatat di rekap hemat.`]);
      }
      return null;
    case "pindah_kado":
      if (parsed.type === "yakin_ambil") {
        await clearPending(db, nomor);
        return jalankanPindah(db, nomor, p.dari, p.ke, p.nominal, p.alasan, now, KATA_BUKA_KUNCI);
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
    case "struk": {
      if (batalin) return selesai(["Oke, struk nggak dicatat."]);
      let kode: EnvelopeKode | null = null;
      if (parsed.type === "ok") kode = p.kode;
      else if (parsed.type === "pilihan" && parsed.n <= PILIHAN_KATEGORI.length) kode = PILIHAN_KATEGORI[parsed.n - 1];
      if (kode && p.hasil.total) {
        await clearPending(db, nomor);
        const nama = `Belanja ${p.hasil.toko ?? "struk"}`.trim();
        return simpanItems(db, nomor, [{ nama, nominal: p.hasil.total, assumedThousand: false, kode }], "[struk]", now, p.tanggal);
      }
      if (parsed.type === "rinci" && p.hasil.items.length) {
        await clearPending(db, nomor);
        const items: ExpenseItem[] = p.hasil.items.map((i, n) => ({ nama: i.nama, nominal: i.harga, assumedThousand: false, kode: p.kodeItem?.[n] ?? detectCategory(i.nama) ?? p.kode }));
        return simpanItems(db, nomor, items, "[struk]", now, p.tanggal);
      }
      return null;
    }
    case "saran":
      if (parsed.type === "ok") {
        await clearPending(db, nomor);
        const n = await jalankanSaran(db, p.transfers, aktor(nomor), now);
        const d = await getDailyStatus(db, now);
        return [`${n} saran dijalankan. Ketik \`batal\` kalau mau dibalikin.${d ? `\n${statusJatah(d)}` : ""}`];
      }
      if (batalin) return selesai(["Oke, saran diabaikan."]);
      return null;
    case "rekon": {
      if (parsed.type === "abaikan" || batalin) {
        await selesaikanRekonsiliasi(db, p.recId, "abaikan", aktor(nomor), now);
        return selesai(["Oke, selisihnya diabaikan (tetap tercatat di riwayat)."]);
      }
      if (p.selisih > 0 && parsed.type === "ok") {
        await selesaikanRekonsiliasi(db, p.recId, "uang_ekstra", aktor(nomor), now);
        return selesai([`Sip, kelebihan ${rp(p.selisih)} masuk Darurat. Sekarang catatan cocok sama dompet.`]);
      }
      if (p.selisih < 0 && parsed.type === "pilihan" && parsed.n <= PILIHAN_KATEGORI.length) {
        const kode = PILIHAN_KATEGORI[parsed.n - 1];
        await selesaikanRekonsiliasi(db, p.recId, { catatKe: kode }, aktor(nomor), now);
        return selesai([`Sip, ${rp(-p.selisih)} dicatat sebagai pengeluaran ${NAMA_PENDEK[kode]} yang kelewat. Sekarang catatan cocok sama dompet.`]);
      }
      return null;
    }
  }
}

// ---------------------------------------------------------------- asisten AI

/**
 * Pesan ini sebaiknya dijawab asisten? Hanya kalau fitur pesan bebas nyala dan AI siap.
 * Kalau AI sedang mati, pesan tetap diproses parser biasa dan diberi `catatan` kenapa AI tidak menjawab.
 */
async function keAsisten(db: Db, nomor: string, text: string, parsed: ParsedMessage, lanjutanUsulan: boolean, now: Date): Promise<{ ya: boolean; catatan?: string }> {
  if (parsed.type !== "unknown" && parsed.type !== "expense") return { ya: false };
  if ((await getSetting(db, "ai_pesan_bebas")) !== "1") return { ya: false };
  const cocok =
    lanjutanUsulan ||
    kalimatBebas(text, parsed) ||
    ((parsed.type === "unknown" || parsed.items.some((i) => i.kode === null)) && (await lagiNgobrol(db, nomor, now)));
  if (!cocok) return { ya: false };
  const st = await statusAI(db, now);
  if (st.siap) return { ya: true };
  return { ya: false, catatan: st.kondisi === "dimatikan" ? undefined : pesanAIMati(st.kondisi === "belum_dicek" || st.kondisi === "ok" ? "gagal" : st.kondisi, st.tahanSampai) };
}

async function cmdTanya(db: Db, nomor: string, pertanyaan: string, now: Date): Promise<string[]> {
  if (!pertanyaan) {
    return ["Tanya apa aja soal duit lo. Contoh:\n• `tanya boleh beli sepatu 150rb?`\n• `tanya berapa jajan gw bulan ini?`\n• `tanya rencanain makan seminggu 140rb`"];
  }
  const r = await tanyaAsisten(db, { kanal: nomor, pesan: pertanyaan, now });
  if (r.ok) return balasAsisten(db, nomor, r, now);
  const baris = [pesanAIMati(r.alasan)];
  const period = await getCurrentPeriod(db);
  if (period) {
    const [balances, daily] = await Promise.all([getBalances(db, period.id), getDailyStatus(db, now)]);
    baris.push("", "Sementara, ini kondisi lo sekarang:", ringkasAmplop(balances));
    if (daily) baris.push(statusJatah(daily));
  }
  return [baris.join("\n")];
}

async function balasAsisten(db: Db, nomor: string, r: Awaited<ReturnType<typeof tanyaAsisten>>, now: Date): Promise<string[]> {
  const baris = [r.balasan];
  if (r.memori.length) baris.push("", ...r.memori.map((m) => `(${m})`));
  if (r.penyedia && r.penyedia !== "claude") baris.push("", `_(dijawab lewat ${r.penyedia === "gemini" ? "Gemini" : "OpenRouter"} karena Claude lagi nggak bisa dipakai)_`);
  if (r.aksi.length) {
    await setPending(db, nomor, { jenis: "ai", aksi: r.aksi }, now);
    baris.push("", teksUsulan(r.aksi));
  }
  return [baris.join("\n")];
}

async function jalankanUsulan(db: Db, nomor: string, aksi: AksiAI[], now: Date): Promise<string[]> {
  const r = await jalankanAksiAI(db, aksi, aktor(nomor), now);
  const baris: string[] = [];
  if (r.berhasil.length) baris.push("*Beres:*", ...r.berhasil.map((b) => `• ${b}`));
  if (r.gagal.length) baris.push(...(r.berhasil.length ? [""] : []), "*Nggak bisa dijalankan:*", ...r.gagal.map((g) => `• ${g}`));
  if (aksi.some((a) => a.jenis === "catat" || a.jenis === "pindah")) {
    const d = await getDailyStatus(db, now);
    if (d) baris.push("", statusJatah(d));
  }
  if (r.berhasil.length && aksi.some((a) => a.jenis !== "pesan_keluarga" && a.jenis !== "kata")) baris.push("Salah? Ketik `batal` buat membatalkan.");
  if (aksi.some((a) => a.jenis === "pesan_keluarga")) baris.push("Pesan ke orang tua dikirim lewat antrean (nggak dikirim jam 22.00–06.00).");
  return [baris.join("\n").trim()];
}

async function cmdIngat(db: Db, isi: string): Promise<string[]> {
  try {
    const m = await ingat(db, isi, "pengguna");
    return [`Oke, gw inget: "${m.isi}" (no. ${m.id}). Asisten bakal pakai ini kalau ngasih saran.`];
  } catch (e) {
    return [e instanceof Error ? e.message : "Gagal menyimpan memori."];
  }
}

async function cmdMemori(db: Db): Promise<string[]> {
  const rows = await db.aiMemori.findMany({ orderBy: { id: "asc" } });
  if (!rows.length) return ["Belum ada yang gw inget. Contoh: `ingat kado buat adik, ultah 20 Nov`."];
  return [["*Yang gw inget tentang lo*", ...rows.map((m) => `${m.id}. ${m.isi}`), "", "Hapus pakai `lupakan <nomor>`."].join("\n")];
}

// ---------------------------------------------------------------- foto struk

async function prosesGambar(db: Db, nomor: string, msg: IncomingMessage, now: Date): Promise<string[]> {
  const period = await getCurrentPeriod(db);
  if (!period) return [BELUM_ADA_PERIODE];
  const buffer = await msg.gambar!();

  // 1) Claude (lebih akurat, bisa baca bukti transfer juga)
  if ((await getSetting(db, "ai_struk")) === "1" && (await statusAI(db, now)).siap) {
    const { hasil: f } = await bacaFotoAI(db, buffer, now);
    if (f?.jenis === "bukti_transfer") {
      const panggilan = f.pengirim && /^(ayah|bapak|papa|abah|papi|bokap|ibu|mama|bunda|umi|mami|nyokap|emak)$/i.test(f.pengirim.trim()) ? f.pengirim : null;
      const dari = namaPengirim(panggilan, await getSetting(db, "pengirim_default"));
      return tawarkanKiriman(db, nomor, dari, f.nominal, now, `Bukti transfer ${rp(f.nominal)}${f.pengirim ? ` dari ${f.pengirim}` : ""} kebaca. Gw catat sebagai kiriman ${dari}.`);
    }
    if (f?.jenis === "lain") return [`${f.keterangan}\nKalau ini struk, coba foto ulang lebih terang & lurus. Atau ketik manual, mis. \`belanja indomaret 27.5k\`.`];
    if (f?.jenis === "struk") {
      const tanggal = f.tanggal && f.tanggal >= period.tanggalMulai && f.tanggal < wibDate(now) ? f.tanggal : undefined;
      return tawarkanStruk(db, nomor, f.hasil, f.kode, now, { kodeItem: f.kodeItem, tanggal, olehAI: true });
    }
  }

  // 2) OCR lokal
  const ocr = msg.ocr ?? (await import("../ocr/engine")).bacaTeksGambar;
  let teks = "";
  try {
    teks = await ocr(buffer);
  } catch (e) {
    console.error("[bot] OCR gagal:", e);
  }
  const hasil = parseStruk(teks);
  if (!hasil.total) return ["Struknya nggak kebaca jelas. Coba foto lebih terang & lurus, atau ketik manual aja, mis. `belanja indomaret 27.5k`."];

  const kategori = hasil.items.map((i) => detectCategory(i.nama)).filter(Boolean) as EnvelopeKode[];
  const kode: EnvelopeKode = kategori.length ? (["makan", "data", "darurat"] as EnvelopeKode[]).sort((a, b) => kategori.filter((k) => k === b).length - kategori.filter((k) => k === a).length)[0] : "makan";
  return tawarkanStruk(db, nomor, hasil, kode, now, {});
}

async function tawarkanStruk(db: Db, nomor: string, hasil: HasilStruk, kode: EnvelopeKode, now: Date, o: { kodeItem?: EnvelopeKode[]; tanggal?: string; olehAI?: boolean }): Promise<string[]> {
  if (!hasil.total) return ["Struknya nggak kebaca jelas."];
  await setPending(db, nomor, { jenis: "struk", hasil, kode, kodeItem: o.kodeItem, tanggal: o.tanggal }, now);
  const baris = [`*Struk ${hasil.toko ?? ""}* terbaca${o.olehAI ? " (dibaca AI)" : ""}: total ${rp(hasil.total)}${hasil.sumberTotal === "jumlah_item" ? " (dijumlah dari item)" : ""}${o.tanggal ? `, tanggal ${fmtTanggal(o.tanggal)}` : ""}.`];
  for (const i of hasil.items.slice(0, 12)) baris.push(`• ${i.nama} ${rp(i.harga)}`);
  if (hasil.items.length > 12) baris.push(`• … ${hasil.items.length - 12} item lagi`);
  baris.push("", `Balas "ok" buat catat ${rp(hasil.total)} ke ${NAMA_PENDEK[kode]}, angka buat pilih amplop lain:`, pilihanBernomor(PILIHAN_KATEGORI));
  if (hasil.items.length > 1) baris.push(`Atau "rinci" buat catat per item (amplop ${o.kodeItem ? "dari AI" : "ditebak"} per item).`);
  baris.push(`"batal" kalau salah baca.`);
  return [baris.join("\n")];
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

async function cmdNol(db: Db, nomor: string, now: Date): Promise<string[]> {
  await markTanpaJajan(db, now, aktor(nomor));
  const streak = await getStreak(db, now);
  return [`Oke, hari ini dicatat nggak jajan. Streak disiplin ${streak} hari.`];
}

async function cmdRekap(db: Db, now: Date): Promise<string[]> {
  const period = await getCurrentPeriod(db);
  if (!period) return [BELUM_ADA_PERIODE];
  return [(await rekapLengkap(db, period.id, now)) ?? BELUM_ADA_PERIODE];
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

async function cmdAktivitas(db: Db): Promise<string[]> {
  const rows = await listActivities(db, { take: 8 });
  if (!rows.length) return ["Belum ada aktivitas."];
  const baris = ["*Aktivitas terakhir*"];
  for (const r of rows) {
    const { jam, menit } = wibHM(r.waktu);
    const siapa = r.oleh === "web" ? "web" : r.oleh === "sistem" ? "sistem" : `…${r.oleh.slice(-4)}`;
    baris.push(`• ${fmtTanggal(wibDate(r.waktu))} ${String(jam).padStart(2, "0")}.${String(menit).padStart(2, "0")} (${siapa}) ${r.ringkasan}${r.dibatalkanPada ? " [dibatalkan]" : ""}`);
  }
  baris.push("", "Ketik `batal` buat membatalkan aksi terakhir. Riwayat lengkap ada di website (menu Aktivitas).");
  return [baris.join("\n")];
}

// ---------------------------------------------------------------- ubah data

async function cmdUndo(db: Db, nomor: string, now: Date): Promise<string[]> {
  const log = await lastUndoable(db);
  if (!log) return ["Belum ada aksi yang bisa dibatalin."];
  await setPending(db, nomor, { jenis: "undo", id: log.id }, now);
  const { jam, menit } = wibHM(log.waktu);
  const siapa = log.oleh === nomor ? "lo" : log.oleh === "web" ? "website" : `nomor …${log.oleh.slice(-4)}`;
  return [`Batalkan aksi terakhir?\n${log.ringkasan}\n(${fmtTanggal(wibDate(log.waktu))} ${String(jam).padStart(2, "0")}.${String(menit).padStart(2, "0")}, oleh ${siapa})\nBalas "ok" buat batalin, atau "batal".`];
}

async function cmdUbah(db: Db, nomor: string, nominal: number | null, now: Date): Promise<string[]> {
  if (!nominal) return ["Nominal barunya berapa? Contoh: `ubah 12k`."];
  const tx = await lastTransaction(db);
  if (!tx) return ["Belum ada catatan yang bisa diubah."];
  await updateTransaction(db, tx.id, { nominal }, now, aktor(nomor));
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
      return tawarkanKiriman(db, nomor, "Lainnya", nominal, now, `Periode minggu ini udah jalan, jadi ${rp(nominal)} ini gw anggap uang tambahan. (Kalau dari Ayah, bisa ketik \`ayah kirim ${Math.round(nominal / 1000)}k\` biar tercatat dari Ayah.)`);
    }
    throw e;
  }
}

async function cmdKoreksiMasuk(db: Db, nomor: string, nominal: number | null, now: Date): Promise<string[]> {
  if (!nominal) return ["Nominal yang benar berapa? Contoh: `koreksi masuk 300`."];
  const period = await getCurrentPeriod(db);
  if (!period) return [BELUM_ADA_PERIODE];
  const { selisih } = await setPemasukan(db, period.id, nominal, now, aktor(nomor));
  if (!selisih) return [`Uang mingguan udah ${rp(nominal)}, nggak ada yang diubah.`];
  return [`Uang mingguan dikoreksi jadi ${rp(nominal)}. Selisih ${rp(Math.abs(selisih))} ${selisih > 0 ? "ditambahkan ke" : "diambil dari"} Darurat. Ketik \`batal\` kalau salah.`];
}

async function cmdKiriman(db: Db, nomor: string, dariRaw: string | null, nominal: number | null, now: Date): Promise<string[]> {
  const dari = namaPengirim(dariRaw, await getSetting(db, "pengirim_default"));
  if (!nominal) return [`Berapa kiriman dari ${dari}? Contoh: \`${dari.toLowerCase()} kirim 100k\`.`];
  return tawarkanKiriman(db, nomor, dari, nominal, now);
}

async function tawarkanKiriman(db: Db, nomor: string, dari: string, nominal: number, now: Date, pembuka?: string): Promise<string[]> {
  if (!(await getCurrentPeriod(db))) return ["Belum ada periode aktif. Catat uang mingguan dulu (`masuk 300`), baru kiriman tambahan."];
  const bagian = await usulanBagi(db, nominal);
  await setPending(db, nomor, { jenis: "kiriman", dari, nominal, bagian }, now);
  return [
    [
      pembuka ?? `Kiriman ${dari} ${rp(nominal)} masuk, alhamdulillah.`,
      `Usulan pembagian: ${ringkasBagian(bagian)}.`,
      `Balas "ok", atau pilih satu amplop:`,
      pilihanBernomor(PILIHAN_BONUS),
      `"batal" kalau nggak jadi.`,
    ].join("\n"),
  ];
}

async function konfirmasiMasuk(db: Db, nomor: string, periodId: number, now: Date): Promise<string[]> {
  await clearPending(db, nomor);
  let hasil: Awaited<ReturnType<typeof confirmPeriodAndNotify>>;
  try {
    hasil = await confirmPeriodAndNotify(db, periodId, now, aktor(nomor));
  } catch (e) {
    if (e instanceof AppError && e.code === "not_found") return ["Usulan itu udah dikonfirmasi atau dibatalin (mungkin dari website). Cek `sisa`."];
    throw e;
  }
  const { period, sisaMakanPindah, sisaDataPindah } = hasil;
  const daily = await getDailyStatus(db, now);
  const baris = [`Sip, periode ${fmtTanggal(period.tanggalMulai)}–${fmtTanggal(period.tanggalSelesai)} resmi jalan.`];
  if (sisaMakanPindah > 0) baris.push(`Sisa makan minggu lalu ${rp(sisaMakanPindah)} udah pindah ke Darurat.`);
  if (sisaDataPindah > 0) baris.push(`Sisa paket data minggu lalu ${rp(sisaDataPindah)} juga pindah ke Darurat.`);
  if (daily) baris.push(statusJatah(daily));
  const bill = await nextPaylaterBill(db);
  if (bill && bill.jatuhTempo <= addDays(wibDate(now), 3)) baris.push(`Ingat: ${bill.nama} ${rp(bill.nominal)} jatuh tempo ${fmtTanggal(bill.jatuhTempo)}. Kalau udah bayar, balas \`bayar paylater\`.`);
  return [baris.join("\n")];
}

async function cmdBayarPaylater(db: Db, nomor: string, nominal: number | null, raw: string, now: Date): Promise<string[]> {
  const bill = await nextPaylaterBill(db, nominal);
  if (!bill) return ["Nggak ada tagihan paylater yang belum lunas. Tambah tagihan baru di website (menu Tagihan)."];
  const r = await payBill(db, bill.id, { nominal: nominal ?? undefined, now, sumber: "wa", pesanAsli: raw, actor: aktor(nomor) });
  const baris = [`Lunas: ${bill.nama} ${fmtTanggal(bill.jatuhTempo)} dibayar ${rp(r.dibayar)}.`];
  if (nominal && nominal !== bill.nominal) baris.push(`(Perkiraan tadinya ${rp(bill.nominal)}, udah gw sesuaikan.)`);
  if (r.saldoSetelah !== null) baris.push(r.saldoSetelah >= 0 ? `Sisa amplop Paylater ${rp(r.saldoSetelah)}.` : `Amplop Paylater minus ${rp(-r.saldoSetelah)}. Tutup pakai \`pindah ${Math.ceil(-r.saldoSetelah / 1000)}k darurat ke paylater alasan nutup tagihan\`.`);
  if (r.terlambatHari > 0) baris.push(`Telat ${r.terlambatHari} hari. Next time gw ingetin H-3 & H-1 ya.`);
  const next = await nextPaylaterBill(db);
  if (next) baris.push(`Tagihan berikutnya: ${rp(next.nominal)} tanggal ${fmtTanggal(next.jatuhTempo)}${next.tanggalPasti ? "" : " (perkiraan)"}.`);
  return [baris.join("\n")];
}

// ---------------------------------------------------------------- rekonsiliasi

async function cmdRekon(db: Db, nomor: string, nominal: number | null, now: Date): Promise<string[]> {
  if (nominal === null) return ["Total uang asli lo (dompet + semua e-wallet) berapa? Contoh: `saldo asli 412k`."];
  const rec = await mulaiRekonsiliasi(db, nominal, aktor(nomor), now);
  if (rec.selisih === 0) return [`Cocok persis! Catatan ${rp(rec.saldoSistem)} = uang asli ${rp(rec.saldoAsli)}. Pembukuan lo rapi.`];
  await setPending(db, nomor, { jenis: "rekon", recId: rec.id, selisih: rec.selisih }, now);
  if (rec.selisih < 0) {
    return [`Menurut catatan harusnya ada ${rp(rec.saldoSistem)}, uang asli ${rp(rec.saldoAsli)}.\nAda ${rp(-rec.selisih)} yang kepake tapi belum dicatat. Catat ke amplop mana?\n${pilihanBernomor(PILIHAN_KATEGORI)}\nAtau "abaikan".`];
  }
  return [`Menurut catatan harusnya ada ${rp(rec.saldoSistem)}, uang asli ${rp(rec.saldoAsli)}.\nAda lebih ${rp(rec.selisih)} (kiriman/pemasukan yang belum dicatat?). Balas "ok" buat masukin ke Darurat, atau "abaikan".`];
}

// ---------------------------------------------------------------- autopilot

async function cmdProyeksi(db: Db, now: Date): Promise<string[]> {
  if (!(await getCurrentPeriod(db))) return [BELUM_ADA_PERIODE];
  const p = await proyeksi(db, now, { minggu: 6 });
  const baris = [`*Proyeksi ${p.minggu.length} minggu* (rata-rata makan ${rp(p.rata.makan)}/minggu${p.rata.sampel ? `, dari ${p.rata.sampel} minggu terakhir` : ", perkiraan awal"})`];
  for (const m of p.minggu) {
    const t = m.tagihan.length ? ` · tagihan ${m.tagihan.map((x) => `${rp(x.nominal)}${x.kurang ? ` (kurang ${rp(x.kurang)})` : ""}`).join(", ")}` : "";
    baris.push(`${fmtTanggal(m.mulai)}: kado ${rp(m.kado)} · darurat ${rp(m.darurat)} · paylater ${rp(m.paylater)}${t}`);
  }
  if (p.kadoSaatTenggat !== null) baris.push("", `Tabungan kado saat tenggat: ${rp(p.kadoSaatTenggat)}.`);
  if (p.risiko.length) baris.push("", "*Risiko*", ...p.risiko.map((r) => `• ${r}`));
  else baris.push("Nggak ada risiko besar. Aman.");
  baris.push("", "Coba juga: `kalau beli sepatu 150k`, `kalau masuk 250 3 minggu`, `saran`.");
  return [baris.join("\n")];
}

async function cmdKalauBeli(db: Db, barang: string, nominal: number | null, now: Date): Promise<string[]> {
  if (!nominal) return [`Harganya berapa? Contoh: \`kalau beli ${barang} 150k\`.`];
  if (!(await getCurrentPeriod(db))) return [BELUM_ADA_PERIODE];
  const s = await simulasi(db, now, { belanja: { nominal, barang } });
  const i = await analyzePurchase(db, nominal, now);
  return [[`*Kalau beli ${barang} ${rp(nominal)}*`, `Setara ${String(i.hariMakan).replace(".", ",")} hari jatah makan.`, ...s.poin.map((p) => `• ${p}`), "", s.aman ? "Kesimpulan: masih aman." : "Kesimpulan: berisiko. Pertimbangkan `mau beli` biar ditahan 24 jam dulu."].join("\n")];
}

async function cmdKalauMasuk(db: Db, nominal: number | null, minggu: number, now: Date): Promise<string[]> {
  if (!nominal) return ["Contoh: `kalau masuk 250 3 minggu`."];
  if (!(await getCurrentPeriod(db))) return [BELUM_ADA_PERIODE];
  const s = await simulasi(db, now, { pemasukan: { nominal, jumlahMinggu: minggu } });
  return [[`*Kalau uang mingguan cuma ${rp(nominal)} selama ${minggu} minggu*`, ...s.poin.map((p) => `• ${p}`), "", s.aman ? "Kesimpulan: masih aman." : "Kesimpulan: berisiko. Siapkan cadangan atau kurangi pengeluaran Darurat."].join("\n")];
}

async function cmdSaran(db: Db, nomor: string, now: Date): Promise<string[]> {
  if (!(await getCurrentPeriod(db))) return [BELUM_ADA_PERIODE];
  const saran = await saranMingguan(db, now);
  if (!saran.length) return ["Nggak ada saran minggu ini. Semua di jalur yang benar."];
  const transfers = saran.filter((s) => s.transfer).map((s) => s.transfer!);
  const baris = ["*Saran autopilot*"];
  saran.forEach((s, i) => baris.push(`${i + 1}. *${s.judul}* — ${s.detail}`));
  if (transfers.length) {
    await setPending(db, nomor, { jenis: "saran", transfers }, now);
    baris.push("", `Balas "ok" buat jalankan ${transfers.length} pemindahan sekaligus (bisa di-\`batal\` nanti).`);
  }
  return [baris.join("\n")];
}

async function cmdPola(db: Db, now: Date): Promise<string[]> {
  const pola = await deteksiPola(db, now);
  if (!pola.length) return ["Datanya belum cukup buat baca pola. Catat terus 1–2 minggu lagi ya."];
  return [["*Pola pengeluaran lo*", ...pola.map((p) => `• *${p.judul}*: ${p.detail}`)].join("\n")];
}

// ---------------------------------------------------------------- hutang-piutang

async function cmdHutang(db: Db, now: Date): Promise<string[]> {
  const r = await ringkasanDebt(db, now);
  if (!r.rows.length) return ["Nggak ada utang-piutang yang aktif."];
  const baris = ["*Utang-piutang aktif*"];
  for (const d of r.rows) {
    baris.push(`• ${d.arah === "piutang" ? `${d.orang} utang ke lo` : `Lo utang ke ${d.orang}`} ${rp(d.sisa)}${d.sisa !== d.nominal ? ` (dari ${rp(d.nominal)})` : ""}${d.catatan ? ` — ${d.catatan}` : ""}, ${d.umurHari} hari`);
  }
  baris.push("", `Total uang lo di orang lain ${rp(r.piutang)} · utang lo ${rp(r.hutang)}.`);
  return [baris.join("\n")];
}

async function cmdHutangBaru(db: Db, nomor: string, arah: "piutang" | "hutang", orang: string, nominal: number | null, now: Date): Promise<string[]> {
  if (!nominal) return [arah === "piutang" ? `Berapa? Contoh: \`pinjemin ${orang} 20k\`.` : `Berapa? Contoh: \`pinjem ke ${orang} 20k\`.`];
  const d = await createDebt(db, { orang, arah, nominal, actor: aktor(nomor), now });
  const r = await ringkasanDebt(db, now);
  return [
    arah === "piutang"
      ? `Dicatat: ${d.orang} pinjem ${rp(nominal)} (diambil dari Darurat). Total uang lo di orang lain ${rp(r.piutang)}.\nKalau dia bayar, ketik \`${d.orang.toLowerCase()} bayar ${Math.round(nominal / 1000)}k\`.`
      : `Dicatat: lo pinjem ${rp(nominal)} ke ${d.orang} (masuk Darurat). Total utang lo ${rp(r.hutang)}.\nKalau udah bayar, ketik \`bayar utang ${d.orang.toLowerCase()}\`.`,
  ];
}

async function cmdHutangBayar(db: Db, nomor: string, arah: "piutang" | "hutang", orang: string, nominal: number | null, now: Date): Promise<string[]> {
  const r = await bayarDebt(db, { orang, arah, nominal, actor: aktor(nomor), now });
  if (arah === "piutang") return [`${r.debt.orang} bayar ${rp(r.dibayar)}, masuk ke Darurat.${r.lunas ? " Lunas!" : ` Sisa utangnya ${rp(r.sisa)}.`}`];
  return [`Bayar utang ke ${r.debt.orang} ${rp(r.dibayar)} dicatat (dari Darurat).${r.lunas ? " Lunas!" : ` Sisa utang lo ${rp(r.sisa)}.`}`];
}

async function cmdPatungan(db: Db, nomor: string, barang: string, nominal: number | null, orang: string[], now: Date): Promise<string[]> {
  if (!nominal) return ["Contoh: `patungan galon 18k sama budi andi`."];
  const r = await patungan(db, { barang, total: nominal, orang, actor: aktor(nomor), now });
  return [`Patungan ${barang} ${rp(nominal)} dibagi ${r.orang.length + 1}: bagian lo ${rp(r.bagianSendiri)} (dicatat ke ${NAMA_PENDEK[r.kode]}), ${r.orang.join(", ")} masing-masing utang ${rp(r.bagianTeman)} ke lo.`];
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
  return jalankanPindah(db, nomor, dari, ke, nominal, alasan, now);
}

async function jalankanPindah(db: Db, nomor: string, dari: EnvelopeKode, ke: EnvelopeKode, nominal: number, alasan: string, now: Date, konfirmasi?: string): Promise<string[]> {
  const r = await transferBetween(db, { dari, ke, nominal, alasan, now, sumber: "wa", konfirmasiBukaKunci: konfirmasi, actor: aktor(nomor) });
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

async function putuskanTahan(db: Db, nomor: string, id: number, keputusan: "beli" | "batal", now: Date): Promise<string[]> {
  const { hold, saldoSetelah } = await decideHold(db, id, keputusan, now, "wa", aktor(nomor));
  if (keputusan === "batal") return [`Mantap! ${hold.barang} nggak jadi dibeli, ${rp(hold.nominal)} diselamatkan.`];
  return [`Oke, ${hold.barang} ${rp(hold.nominal)} dicatat ke Darurat. Sisa Darurat ${rp(saldoSetelah ?? 0)}.`];
}

// ---------------------------------------------------------------- catat pengeluaran

async function catat(db: Db, nomor: string, items: ExpenseItem[], raw: string, now: Date, tanggal?: string): Promise<string[]> {
  if (items.some((i) => i.kode === null)) return tanyaKategori(db, nomor, { jenis: "kategori", items, raw, tanggal }, now);
  return simpanAtauTahan(db, nomor, items, raw, now, tanggal);
}

/** Tanya amplop untuk item pertama yang belum jelas; kalau AI aktif, sertakan tebakannya. */
async function tanyaKategori(db: Db, nomor: string, p: Extract<Pending, { jenis: "kategori" }>, now: Date): Promise<string[]> {
  const item = p.items.find((i) => i.kode === null)!;
  let saran: { kode: EnvelopeKode; kata: string } | undefined;
  if ((await getSetting(db, "ai_tebak_kategori")) === "1" && (await statusAI(db, now)).siap) {
    saran = (await tebakKategoriAI(db, item.nama, now)) ?? undefined;
  }
  await setPending(db, nomor, { ...p, saran }, now);
  if (saran) {
    return [`"${item.nama}" ${rp(item.nominal)} kayaknya masuk *${NAMA_PENDEK[saran.kode]}* (tebakan AI).\nBalas "ok" kalau bener, atau pilih amplop lain:\n${pilihanBernomor(PILIHAN_KATEGORI)}`];
  }
  return [pertanyaanKategori(p.items)];
}

/** Pembelian non-rutin (satu item Darurat di atas batas) masuk mode tahan belanja dulu. */
async function simpanAtauTahan(db: Db, nomor: string, items: ExpenseItem[], raw: string, now: Date, tanggal?: string): Promise<string[]> {
  if (!tanggal && items.length === 1 && items[0].kode === "darurat") {
    const batas = await getSettingNumber(db, "batas_tahan");
    if (batas > 0 && items[0].nominal >= batas) return tawarkanTahan(db, nomor, items[0].nama, items[0].nominal, raw, now);
  }
  return simpanItems(db, nomor, items, raw, now, tanggal);
}

function pertanyaanKategori(items: ExpenseItem[]): string {
  const item = items.find((i) => i.kode === null)!;
  return `"${item.nama}" ${rp(item.nominal)} masuk amplop mana?\n${pilihanBernomor(PILIHAN_KATEGORI)}\nBalas angkanya, atau "batal".`;
}

async function lanjutKategori(db: Db, nomor: string, p: Extract<Pending, { jenis: "kategori" }>, kode: EnvelopeKode, now: Date): Promise<string[]> {
  const items = p.items.map((i) => ({ ...i }));
  const item = items.find((i) => i.kode === null)!;
  item.kode = kode;
  // belajar: lain kali kata ini langsung masuk amplop yang sama
  if (p.saran && p.saran.kode === kode) await ajariKata(db, p.saran.kata, kode, "ai");
  else await ajariKata(db, item.nama, kode, "pengguna");
  if (items.some((i) => i.kode === null)) return tanyaKategori(db, nomor, { ...p, items, saran: undefined }, now);
  await clearPending(db, nomor);
  return simpanAtauTahan(db, nomor, items, p.raw, now, p.tanggal);
}

async function simpanItems(db: Db, nomor: string, items: ExpenseItem[], raw: string, now: Date, tanggal?: string): Promise<string[]> {
  const saved: { item: ExpenseItem; kode: EnvelopeKode; melewati: boolean; id: number }[] = [];
  for (const item of items) {
    const kode = item.kode as EnvelopeKode;
    const r = await recordExpense(db, { kode, nominal: item.nominal, catatan: item.nama, sumber: "wa", pesanAsli: raw, now, tanggal, log: false });
    saved.push({ item, kode, melewati: r.melewatiBatas20, id: r.id });
  }
  await logActivity(db, aktor(nomor), "catat", `Catat ${saved.map((s) => `${s.item.nama} ${rp(s.item.nominal)}`).join(", ")}`, {
    undo: { t: "hapus_tx", ids: saved.map((s) => s.id) },
    now,
  });

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

  for (const s of saved) {
    const l = await cekLonjakan(db, s.item.nama, s.item.nominal, now, s.id);
    if (l) baris.push(`Catatan harga: ${s.item.nama} ${rp(s.item.nominal)}, ${l.persen}% di atas biasanya (${rp(l.biasanya)}).`);
  }

  const asumsi = saved.filter((s) => s.item.assumedThousand).map((s) => `${s.item.nominal / 1000} → ${rp(s.item.nominal)}`);
  if (asumsi.length) baris.push(`(Angka tanpa satuan dianggap ribuan: ${asumsi.join(", ")}. Salah? Ketik \`ubah <nominal>\`.)`);
  return [baris.join("\n")];
}
