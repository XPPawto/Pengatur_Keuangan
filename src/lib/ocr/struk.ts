/**
 * Parser teks struk belanja (hasil OCR) → toko, item, total. Fungsi murni supaya bisa dites.
 */
export interface ItemStruk {
  nama: string;
  harga: number;
}

export interface HasilStruk {
  toko: string | null;
  items: ItemStruk[];
  total: number | null;
  /** total dari baris TOTAL kalau ada, atau jumlah item */
  sumberTotal: "baris_total" | "jumlah_item" | null;
}

const ABAIKAN = /(sub\s*total|total\s*(item|qty|disc|hemat)|tunai|cash|kembali|kembalian|change|ppn|dpp|pajak|diskon|disc\b|hemat|potongan|qris|debit|kredit|bayar|voucher|member|poin|point|npwp|telp|kasir|struk|terima\s*kasih|layanan|harga\s*jual|kritik|saran)/i;
const TOTAL_RE = /\b(grand\s*total|total\s*belanja|total\s*bayar|total\s*harga|jumlah\s*bayar|total|jumlah)\b[^\d]*([\d.,]{3,})/i;
const HARGA_AKHIR = /(\d{1,3}(?:[.,]\d{3})+|\d{4,7})\s*-?\s*$/;
const TOKO = [/indomaret/i, /alfamart/i, /alfamidi/i, /superindo/i, /hypermart/i, /giant/i, /lawson/i, /familymart/i, /circle\s*k/i];

export function angka(s: string): number | null {
  let b = s.replace(/[^\d.,]/g, "");
  if (!b) return null;
  // desimal sen (",00" / ".00") dibuang: 27.500,00 → 27.500 ; 27500.00 → 27500
  if (/[.,]\d{2}$/.test(b)) b = b.slice(0, -3);
  const n = Number(b.replace(/[.,]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function rapikanNama(s: string): string {
  return s
    .replace(/\b\d+\s*[x×@]\s*[\d.,]+/gi, " ") // "2 x 3.500"
    .replace(/[\d.,]{3,}/g, " ")
    .replace(/[^a-zA-Z0-9 /&-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function parseStruk(teks: string): HasilStruk {
  const baris = teks
    .split(/\r?\n/)
    .map((b) => b.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  let toko: string | null = null;
  for (const b of baris.slice(0, 6)) {
    const t = TOKO.find((re) => re.test(b));
    if (t) {
      toko = b.match(t)![0].toUpperCase();
      break;
    }
  }
  if (!toko) toko = baris.find((b) => /[a-z]{3,}/i.test(b) && !/\d{3,}/.test(b))?.slice(0, 40) ?? null;

  let total: number | null = null;
  for (const b of baris) {
    if (/sub\s*total|total\s*(item|qty|disc|hemat)/i.test(b)) continue;
    const m = TOTAL_RE.exec(b);
    if (m) {
      const n = angka(m[2]);
      if (n && n >= 500) total = n; // ambil baris TOTAL terakhir yang valid
    }
  }

  const items: ItemStruk[] = [];
  for (const b of baris) {
    if (ABAIKAN.test(b) || TOTAL_RE.test(b)) continue;
    const m = HARGA_AKHIR.exec(b);
    if (!m) continue;
    const harga = angka(m[1]);
    if (!harga || harga < 100 || harga > 5_000_000) continue;
    const nama = rapikanNama(b.slice(0, m.index));
    if (nama.length < 2 || !/[a-z]{2,}/.test(nama)) continue;
    items.push({ nama, harga });
  }

  if (total !== null) return { toko, items, total, sumberTotal: "baris_total" };
  if (items.length) return { toko, items, total: items.reduce((a, i) => a + i.harga, 0), sumberTotal: "jumlah_item" };
  return { toko, items, total: null, sumberTotal: null };
}
