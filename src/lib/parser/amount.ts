/**
 * Parser nominal untuk tulisan santai: 12k, 12rb, 12 ribu, 12.000, 12000, 1,5jt, rp5.000.
 * Angka polos < 1000 dianggap "ribuan" (masuk 300 = Rp300.000) dan ditandai `assumedThousand`.
 */
export interface FoundAmount {
  value: number;
  /** posisi token di teks asal (termasuk satuan), untuk dipotong dari nama item */
  start: number;
  end: number;
  assumedThousand: boolean;
  /** true kalau ada satuan (k/rb/jt), pemisah ribuan, atau angkanya >= 1000 */
  strong: boolean;
}

const UNIT_MULT: Record<string, number> = { k: 1000, rb: 1000, ribu: 1000, jt: 1_000_000, juta: 1_000_000 };

const NUM_RE = /\d+(?:[.,]\d+)*/g;
const UNIT_RE = /^\s*(k|rb|ribu|jt|juta)(?![a-z])/i;
/** Kata setelah angka yang menandakan jumlah barang, bukan uang ("2 kg", "3 bungkus"). */
const QTY_RE = /^\s+(kg|kilo|gr|gram|g|ons|liter|ltr|l|bks|bungkus|butir|pcs|biji|buah|papan|sachet|sct|potong|porsi|bh|x|kali|hari|galon|kaleng|botol)(?![a-z])/i;
const THOUSANDS_RE = /^\d{1,3}(?:[.,]\d{3})+$/;

/** Nilai angka dengan satuan: "1,5" + jt -> 1.5 jt. Mengembalikan null kalau bentuknya aneh. */
function withUnit(num: string, mult: number): number | null {
  const seps = num.match(/[.,]/g) ?? [];
  let n: number;
  if (seps.length === 0) {
    n = Number(num);
  } else if (seps.length === 1 && /^\d+[.,]\d{1,2}$/.test(num)) {
    n = Number(num.replace(",", "."));
  } else {
    n = Number(num.replace(/[.,]/g, ""));
  }
  if (!Number.isFinite(n)) return null;
  return Math.round(n * mult);
}

export function findAmounts(text: string): FoundAmount[] {
  const out: FoundAmount[] = [];
  for (const m of text.matchAll(NUM_RE)) {
    const num = m[0];
    let start = m.index!;
    const end0 = start + num.length;

    // huruf langsung sebelum angka (mis. "a5") bukan nominal, kecuali awalan "rp"
    const before = text.slice(0, start);
    const rp = /rp\.?\s*$/i.exec(before);
    if (rp && !/[a-z0-9]$/i.test(before.slice(0, rp.index))) {
      start = rp.index;
    } else if (/[a-z0-9]$/i.test(before)) {
      continue;
    }

    const rest = text.slice(end0);
    const unit = UNIT_RE.exec(rest);
    if (unit) {
      const value = withUnit(num, UNIT_MULT[unit[1].toLowerCase()]);
      if (value && value > 0) {
        out.push({ value, start, end: end0 + unit[0].length, assumedThousand: false, strong: true });
      }
      continue;
    }
    // huruf menempel setelah angka (2kg, 3x, 5pcs) = jumlah/satuan, bukan uang
    if (/^[a-z]/i.test(rest) || QTY_RE.test(rest)) continue;

    if (THOUSANDS_RE.test(num)) {
      const value = Number(num.replace(/[.,]/g, ""));
      if (value > 0) out.push({ value, start, end: end0, assumedThousand: false, strong: true });
    } else if (/^\d+$/.test(num)) {
      const n = Number(num);
      if (n >= 1000) out.push({ value: n, start, end: end0, assumedThousand: false, strong: true });
      else if (n > 0) out.push({ value: n * 1000, start, end: end0, assumedThousand: true, strong: false });
    }
  }
  return out;
}

/** Pilih nominal utama dalam satu segmen: nominal "kuat" terakhir, kalau tak ada ambil angka polos terakhir. */
export function pickAmount(text: string): FoundAmount | null {
  const all = findAmounts(text);
  if (all.length === 0) return null;
  const strong = all.filter((a) => a.strong);
  return strong.length ? strong[strong.length - 1] : all[all.length - 1];
}

/** Parse string yang isinya cuma nominal ("12k", "1,5jt"). */
export function parseAmount(text: string): number | null {
  const t = text.trim();
  const a = pickAmount(t);
  if (!a) return null;
  if (t.slice(0, a.start).trim() || t.slice(a.end).trim()) return null;
  return a.value;
}
