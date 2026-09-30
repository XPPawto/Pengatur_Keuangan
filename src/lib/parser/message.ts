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
];

const PINDAH_RE = /^pindah\s+(\S+(?:\s?(?:k|rb|ribu|jt|juta)\b)?)\s+(?:dari\s+)?(.+?)\s+ke\s+(.+?)(?:\s+(?:alasan|karena|krn|soalnya|buat|untuk)\s+(.+))?$/;
const UBAH_RE = /^(ubah|ganti|koreksi|ralat)(?:\s+terakhir)?(?:\s+(?:jadi|ke))?\s+(.+)$/;

const MASUK_RE = /^(masuk|gajian|gajih|gaji|uang masuk|duit masuk|transfer masuk|kiriman)(?:\s+(.*))?$/;
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
