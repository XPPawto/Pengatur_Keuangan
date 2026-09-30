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
  | { type: "expense"; items: ExpenseItem[] }
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
  | { type: "pindah" }
  | { type: "mau_beli" }
  | { type: "unknown" };

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
  [/^pindah\b/, { type: "pindah" }],
  [/^mau beli\b/, { type: "mau_beli" }],
  [/^yakin ambil tabungan$/, { type: "yakin_ambil" }],
];

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

  const items = parseExpenses(t, dict);
  if (items) return { type: "expense", items };
  return { type: "unknown" };
}
