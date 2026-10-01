import type { EnvelopeKode } from "../types";
import { findAmounts, parseAmount, pickAmount } from "./amount";
import { DEFAULT_DICTIONARY, detectCategory, type CategoryDictionary } from "./category";

export interface ExpenseItem {
  nama: string;
  nominal: number;
  /** nominal polos < 1000 yang dianggap ribuan ("tempe 5" = Rp5.000) */
  assumedThousand: boolean;
  /** null = kategori tidak jelas, bot harus bertanya */
  kode: EnvelopeKode | null;
}

export type ParsedMessage =
  | { type: "masuk"; nominal: number | null }
  | { type: "expense"; items: ExpenseItem[]; kemarin: boolean }
  | { type: "sisa" }
  | { type: "hari_ini" }
  | { type: "batal" }
  | { type: "nol" }
  | { type: "bantuan" }
  | { type: "ok" }
  | { type: "tidak" }
  | { type: "pilihan"; n: number }
  | { type: "yakin_ambil" }
  | { type: "target" }
  | { type: "belanja" }
  | { type: "menu" }
  | { type: "bayar_paylater"; nominal: number | null }
  | { type: "pindah"; nominal: number | null; dari: EnvelopeKode | null; ke: EnvelopeKode | null; alasan: string | null }
  | { type: "mau_beli"; barang: string; nominal: number | null }
  | { type: "beli" }
  | { type: "tagihan" }
  | { type: "rekap" }
  | { type: "laporan" }
  | { type: "jatah" }
  | { type: "ubah"; nominal: number | null }
  | { type: "kiriman"; dari: string | null; nominal: number | null }
  | { type: "rekon"; nominal: number | null }
  | { type: "kalau_beli"; barang: string; nominal: number | null }
  | { type: "kalau_masuk"; nominal: number | null; minggu: number }
  | { type: "proyeksi" }
  | { type: "saran" }
  | { type: "pola" }
  | { type: "skor" }
  | { type: "hutang_list" }
  | { type: "piutang_baru"; orang: string; nominal: number | null }
  | { type: "hutang_baru"; orang: string; nominal: number | null }
  | { type: "piutang_bayar"; orang: string; nominal: number | null }
  | { type: "hutang_bayar"; orang: string; nominal: number | null }
  | { type: "patungan"; barang: string; nominal: number | null; orang: string[] }
  | { type: "koreksi_masuk"; nominal: number | null }
  | { type: "aktivitas" }
  | { type: "rinci" }
  | { type: "abaikan" }
  /** `penyedia` terisi kalau pesan diawali kode penyedia (`or` OpenRouter, `gm` Gemini): hanya penyedia itu yang dipakai, tanpa pindah ke cadangan */
  | { type: "tanya"; pertanyaan: string; penyedia?: "gemini" | "openrouter" | "groq" }
  | { type: "ingat"; isi: string }
  | { type: "lupakan"; id: number }
  | { type: "memori" }
  | { type: "reset_obrolan" }
  | { type: "unknown" };

/** Nama amplop yang dimengerti di perintah `pindah`. */
export const ALIAS_AMPLOP: Record<string, EnvelopeKode> = {
  makan: "makan",
  data: "data",
  kuota: "data",
  paket: "data",
  "paket data": "data",
  paylater: "paylater",
  cicilan: "paylater",
  tagihan: "paylater",
  kado: "kado",
  tabungan: "kado",
  "tabungan kado": "kado",
  darurat: "darurat",
  kos: "darurat",
  "darurat kos": "darurat",
};

export function amplopDariNama(nama: string): EnvelopeKode | null {
  return ALIAS_AMPLOP[nama.trim().replace(/\s+/g, " ")] ?? null;
}

export function normalize(text: string): string {
  return text.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

const SIMPLE: [RegExp, ParsedMessage][] = [
  [/^(sisa|saldo|cek|cek sisa|sisa uang|sisa amplop|cek saldo)$/, { type: "sisa" }],
  [/^(hari ?ini|hr ini|transaksi hari ini|catatan hari ini)$/, { type: "hari_ini" }],
  [/^(batal|undo|hapus terakhir|salah catat|salah)$/, { type: "batal" }],
  [/^(nol|0|no spend|((hari ini )?(gak|ga|gk|nggak|ngga|tidak|engga|enggak) jajan( hari ini)?))$/, { type: "nol" }],
  [/^(bantuan|help|\?|perintah|cara pakai)$/, { type: "bantuan" }],
  [/^(ok|oke|okay|okey|y|ya|iya|yes|sip|siap|setuju|oks)$/, { type: "ok" }],
  [/^(tidak|gak jadi|ga jadi|gk jadi|nggak jadi|no|cancel|skip)$/, { type: "tidak" }],
  [/^(target|progres target|tabungan)$/, { type: "target" }],
  [/^(belanja|daftar belanja)$/, { type: "belanja" }],
  [/^(menu|menu hari ini)$/, { type: "menu" }],
  [/^yakin ambil tabungan$/, { type: "yakin_ambil" }],
  [/^(beli|jadi beli|jadi|tetap beli|tetep beli)$/, { type: "beli" }],
  [/^(tagihan|cek tagihan|daftar tagihan|paylater)$/, { type: "tagihan" }],
  [/^(rekap|rekap minggu ini|minggu ini|ringkasan)$/, { type: "rekap" }],
  [/^(laporan|laporan minggu ini)$/, { type: "laporan" }],
  [/^(jatah|jatah hari ini|jatah makan)$/, { type: "jatah" }],
  [/^(proyeksi|ramalan|prediksi|forecast)$/, { type: "proyeksi" }],
  [/^(saran|autopilot|saran mingguan)$/, { type: "saran" }],
  [/^(pola|analisis|insight|kebiasaan)$/, { type: "pola" }],
  [/^(skor|level|prestasi|tantangan|lencana|badge)$/, { type: "skor" }],
  [/^(utang|hutang|piutang|daftar utang|daftar hutang)$/, { type: "hutang_list" }],
  [/^(aktivitas|log|riwayat aktivitas)$/, { type: "aktivitas" }],
  [/^(rinci|rincian|per item)$/, { type: "rinci" }],
  [/^(abaikan|biarin|skip aja)$/, { type: "abaikan" }],
];

const KELUARGA = "ayah|bapak|papa|abah|papi|bokap|ibu|mama|bunda|umi|mami|nyokap|om|tante|kakak|kak|abang|nenek|kakek|paman|bibi";
const KIRIMAN_RE = [
  // "ayah kirim 100k", "ayah tf 100rb", "bapak transfer 50k"
  new RegExp(`^(${KELUARGA})\\s+(?:kirim|ngirim|tf|transfer|ngasih|kasih|nambahin|nambah)(?:\\s+(?:uang|duit))?\\s+(.+)$`),
  // "kiriman ayah 100k", "dari ayah 100k", "tf dari ayah 100k", "dapet dari ayah 100k"
  new RegExp(`^(?:kiriman|tf|transfer|dapet|dapat|dikirim)?\\s*(?:dari\\s+)?(${KELUARGA})\\s+(.+)$`),
  // "kiriman 100k dari ayah", "dapet 100k dari om"
  new RegExp(`^(?:kiriman|tambahan|dapet|dapat|dikirim|tf|transfer)\\s+(.+?)\\s+dari\\s+([a-z]+)$`),
];
const REKON_RE = /^(?:saldo asli|cek saldo|uang (?:gw|gue|aku|asli)|rekon|rekonsiliasi|cocokin|cocokkan|total uang)\s+(.+)$/;
const KALAU_BELI_RE = /^(?:kalau|kalo|klo|gimana kalau|gmn kalo)\s+(?:beli|jajan)\s+(.+)$/;
const KALAU_MASUK_RE = /^(?:kalau|kalo|klo)\s+(?:uang\s+)?masuk(?:nya)?(?:\s+cuma)?\s+(\S+)(?:\s+(?:selama\s+)?(\d+)\s+minggu)?$/;
const KOREKSI_MASUK_RE = /^(?:koreksi|ralat|ubah|ganti)\s+(?:uang\s+)?masuk(?:\s+jadi)?\s+(.+)$/;
const NAMA = "([a-z]{2,15})";
const PIUTANG_BARU = [
  new RegExp(`^(?:pinjemin|minjemin|pinjamkan|pinjamin|talangin|nalangin)\\s+${NAMA}\\s+(.+)$`),
  new RegExp(`^${NAMA}\\s+(?:pinjem|minjem|pinjam|ngutang|utang|ngebon)\\s+(.+)$`),
];
const HUTANG_BARU = [new RegExp(`^(?:pinjem|minjem|pinjam|ngutang|utang|hutang)\\s+(?:ke|sama|dari)\\s+${NAMA}\\s+(.+)$`)];
const PIUTANG_BAYAR = new RegExp(`^${NAMA}\\s+(?:bayar|balikin|ngembaliin|kembaliin|lunas|lunasin|nyicil|cicil)(?:\\s+(?:utang|utangnya))?(?:\\s+(.+))?$`);
const HUTANG_BAYAR = [
  new RegExp(`^(?:bayar|lunasin|nyicil|cicil)\\s+(?:utang|hutang)\\s+(?:ke\\s+)?${NAMA}(?:\\s+(.+))?$`),
  new RegExp(`^(?:balikin|kembaliin|ngembaliin)\\s+(?:uang\\s+)?(?:ke\\s+)?${NAMA}(?:\\s+(.+))?$`),
];
const PATUNGAN_RE = /^(?:patungan|patung|urunan|split)\s+(.+?)\s+(\S+)\s+(?:sama|bareng|dengan|ama|bagi)\s+(.+)$/;
const BUKAN_NAMA = new Set(["beli", "bayar", "paylater", "kirim", "masuk", "pindah", "sisa", "mau", "kalau", "kalo", "patungan", "ubah", "batal", "utang", "hutang", "uang", "duit"]);

function nominalOrNull(s: string | undefined): number | null {
  return s ? parseAmount(s.trim()) : null;
}

const PINDAH_RE = /^pindah\s+(\S+(?:\s?(?:k|rb|ribu|jt|juta)\b)?)\s+(?:dari\s+)?(.+?)\s+ke\s+(.+?)(?:\s+(?:alasan|karena|krn|soalnya|buat|untuk)\s+(.+))?$/;
const UBAH_RE = /^(ubah|ganti|koreksi|ralat)(?:\s+terakhir)?(?:\s+(?:jadi|ke))?\s+(.+)$/;

const MASUK_RE = /^(masuk|gajian|gajih|gaji|uang masuk|duit masuk|uang mingguan)(?:\s+(.*))?$/;
const BAYAR_PAYLATER_RE = /^(bayar|lunasin|lunas|bayarin)\s+paylater(?:\s+(.*))?$/;

/** Pisah beberapa item dalam satu pesan: "tempe 5k sama telur 14k", "a 1k, b 2k", baris baru, "+". */
export function splitItems(text: string): string[] {
  return text
    .split(/\s+(?:sama|dan|plus|lalu|terus|trus)\s+|\n|;|\s*&\s*|\s*\+\s*|,(?!\d)/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

function cleanName(text: string): string {
  return text
    .replace(/\b(beli|bayar|buat|untuk|tadi|barusan|habis)\b/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s\-:]+|[\s\-:]+$/g, "")
    .trim();
}

function itemFromSegment(seg: string, dict: CategoryDictionary): ExpenseItem | null {
  const amt = pickAmount(seg);
  if (!amt) return null;
  const nameRaw = `${seg.slice(0, amt.start)} ${seg.slice(amt.end)}`;
  const nama = cleanName(nameRaw);
  // kategori dicari dari teks lengkap segmen, supaya "beli beras" tetap terbaca
  return { nama: nama || seg.trim(), nominal: amt.value, assumedThousand: amt.assumedThousand, kode: detectCategory(nameRaw, dict) };
}

export function parseExpenses(text: string, dict: CategoryDictionary = DEFAULT_DICTIONARY): ExpenseItem[] | null {
  const segs = splitItems(text);
  if (segs.length === 0) return null;
  const items = segs.map((s) => itemFromSegment(s, dict));
  if (items.every((i) => i !== null)) return items as ExpenseItem[];
  // ada segmen tanpa nominal ("beras sama telur 40k"): perlakukan sebagai satu item
  if (findAmounts(text).length >= 1) {
    const one = itemFromSegment(text, dict);
    if (one) return [one];
  }
  return null;
}

export function parseMessage(raw: string, dict: CategoryDictionary = DEFAULT_DICTIONARY): ParsedMessage {
  const t = normalize(raw);
  if (!t) return { type: "unknown" };

  for (const [re, msg] of SIMPLE) if (re.test(t)) return msg;
  if (/^[1-9]$/.test(t)) return { type: "pilihan", n: Number(t) };

  // asisten AI & memori
  const tanya = /^(?:(or|openrouter)|(gm|gemini)|(gr|groq)|tanya|ai|asisten|claude)\b[\s:,]*/.exec(t);
  if (tanya) {
    const penyedia = tanya[1] ? ("openrouter" as const) : tanya[2] ? ("gemini" as const) : tanya[3] ? ("groq" as const) : undefined;
    return { type: "tanya", pertanyaan: raw.trim().replace(/^[^\s:,]+[\s:,]*/, "").trim(), ...(penyedia ? { penyedia } : {}) };
  }
  if (/^(memori|ingatan|isi memori|lihat memori)$/.test(t)) return { type: "memori" };
  if (/^(reset obrolan|obrolan baru|mulai obrolan baru|lupakan obrolan)$/.test(t)) return { type: "reset_obrolan" };
  const lupa = /^(?:lupakan|lupain|hapus memori)\s+(?:no\.?\s*|nomor\s+)?(\d+)$/.exec(t);
  if (lupa) return { type: "lupakan", id: Number(lupa[1]) };
  const ingat = /^(?:ingat|inget|simpan memori)(?:\s+(?:ya|yah))?(?:\s+(?:bahwa|kalau|kalo))?[\s:,]+(.{3,})$/.exec(t);
  if (ingat) return { type: "ingat", isi: raw.trim().replace(/^(?:ingat|inget|simpan memori)(?:\s+(?:ya|yah))?(?:\s+(?:bahwa|kalau|kalo))?[\s:,]+/i, "").trim() };

  const koreksi = KOREKSI_MASUK_RE.exec(t);
  if (koreksi) return { type: "koreksi_masuk", nominal: nominalOrNull(koreksi[1]) };

  const kalauMasuk = KALAU_MASUK_RE.exec(t);
  if (kalauMasuk) return { type: "kalau_masuk", nominal: nominalOrNull(kalauMasuk[1]), minggu: kalauMasuk[2] ? Math.min(8, Number(kalauMasuk[2])) : 1 };
  const kalauBeli = KALAU_BELI_RE.exec(t);
  if (kalauBeli) {
    const a = pickAmount(kalauBeli[1]);
    const barang = a ? `${kalauBeli[1].slice(0, a.start)} ${kalauBeli[1].slice(a.end)}`.replace(/\s+/g, " ").trim() : kalauBeli[1];
    return { type: "kalau_beli", barang: barang.replace(/\?$/, "").trim() || "barang", nominal: a?.value ?? null };
  }

  const rekon = REKON_RE.exec(t);
  if (rekon) return { type: "rekon", nominal: nominalOrNull(rekon[1]) };

  for (const [i, re] of KIRIMAN_RE.entries()) {
    const m = re.exec(t);
    if (!m) continue;
    const [dari, nom] = i === 2 ? [m[2], m[1]] : [m[1], m[2]];
    const nominal = nominalOrNull(nom);
    if (nominal || i === 0) return { type: "kiriman", dari, nominal };
  }

  const kirimanPolos = /^(?:kiriman|tambahan|uang tambahan|uang kiriman|tf masuk|transferan)\s+(\S+)$/.exec(t);
  if (kirimanPolos) return { type: "kiriman", dari: null, nominal: nominalOrNull(kirimanPolos[1]) };

  const patungan = PATUNGAN_RE.exec(t);
  if (patungan) {
    const orang = patungan[3].split(/\s*(?:,|dan|&|\s)\s*/).filter((x) => /^[a-z]{2,15}$/.test(x));
    return { type: "patungan", barang: patungan[1], nominal: nominalOrNull(patungan[2]), orang };
  }
  for (const re of HUTANG_BARU) {
    const m = re.exec(t);
    if (m) return { type: "hutang_baru", orang: m[1], nominal: nominalOrNull(m[2]) };
  }
  for (const re of HUTANG_BAYAR) {
    const m = re.exec(t);
    if (m && !BUKAN_NAMA.has(m[1])) return { type: "hutang_bayar", orang: m[1], nominal: nominalOrNull(m[2]) };
  }
  for (const re of PIUTANG_BARU) {
    const m = re.exec(t);
    if (m && !BUKAN_NAMA.has(m[1]) && !detectCategory(m[1], dict)) return { type: "piutang_baru", orang: m[1], nominal: nominalOrNull(m[2]) };
  }
  const pb = PIUTANG_BAYAR.exec(t);
  if (pb && !BUKAN_NAMA.has(pb[1]) && !detectCategory(pb[1], dict)) return { type: "piutang_bayar", orang: pb[1], nominal: nominalOrNull(pb[2]) };

  const masuk = MASUK_RE.exec(t);
  if (masuk) return { type: "masuk", nominal: masuk[2] ? parseAmount(masuk[2]) : null };

  const bayar = BAYAR_PAYLATER_RE.exec(t);
  if (bayar) return { type: "bayar_paylater", nominal: bayar[2] ? parseAmount(bayar[2]) : null };

  if (/^pindah\b/.test(t)) {
    const m = PINDAH_RE.exec(t);
    if (!m) return { type: "pindah", nominal: null, dari: null, ke: null, alasan: null };
    return { type: "pindah", nominal: parseAmount(m[1]), dari: amplopDariNama(m[2]), ke: amplopDariNama(m[3]), alasan: m[4]?.trim() || null };
  }

  if (/^mau beli\b/.test(t)) {
    const rest = t.replace(/^mau beli\s*/, "");
    const a = pickAmount(rest);
    const barang = a ? `${rest.slice(0, a.start)} ${rest.slice(a.end)}`.replace(/\s+/g, " ").trim() : rest;
    return { type: "mau_beli", barang: barang || "barang", nominal: a?.value ?? null };
  }

  const ubah = UBAH_RE.exec(t);
  if (ubah) return { type: "ubah", nominal: parseAmount(ubah[2]) };

  const kemarin = /^(kemarin|kmrn|kemaren)\b\s*/.exec(t);
  const body = kemarin ? t.slice(kemarin[0].length) : t;
  const items = parseExpenses(body, dict);
  if (items) return { type: "expense", items, kemarin: !!kemarin };
  return { type: "unknown" };
}

const KATA_TANYA = /^(berapa|brp|kapan|kenapa|knp|mengapa|gimana|gmn|bagaimana|apa|apakah|boleh|bolehkah|bisa|bisakah|bantu|bantuin|tolong|buatin|buatkan|bikinin|bikin|masakin|rencana|rencanain|rencanakan|saran|sarannya|menurut|jelasin|jelaskan|analisa|analisis|evaluasi|review|kira|kira2|enaknya|mending|sebaiknya|harusnya|cek apakah|hitungin|hitung|bandingin|bandingkan|ide|idenya)\b/;
const KATA_SAMBUNG = /\b(tadi|terus|trus|kemarin|kmrn|kemaren|barusan|abis|habis|soalnya|gara|karena)\b/;

/**
 * Kalimat bebas yang lebih cocok dijawab asisten AI daripada parser perintah: pertanyaan, permintaan,
 * atau cerita pengeluaran panjang yang parser cuma bisa tebak setengah-setengah.
 */
export function kalimatBebas(raw: string, parsed: ParsedMessage): boolean {
  const t = normalize(raw);
  const kata = t.split(" ").length;
  if (parsed.type === "unknown") return kata >= 3 || t.includes("?");
  if (parsed.type !== "expense") return false;
  if (t.includes("?") || KATA_TANYA.test(t)) return true;
  return parsed.items.some((i) => i.nama.split(" ").length >= 5 || (kata >= 5 && KATA_SAMBUNG.test(i.nama)));
}
