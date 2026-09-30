import type { EnvelopeKode } from "../types";

export type CategoryDictionary = Partial<Record<EnvelopeKode, string[]>>;

/** Kamus bawaan (PRD). Kata kunci tambahan dari daftar belanja di database digabung lewat `mergeDictionary`. */
export const DEFAULT_DICTIONARY: CategoryDictionary = {
  makan: [
    "tempe", "tahu", "telur", "telor", "beras", "nasi", "mie", "mi", "indomie", "mie instan", "nasgor", "bumbu",
    "minyak", "kecap", "garam", "bawang", "cabai", "cabe", "lombok", "galon", "air", "teri", "ikan", "ikan asin",
    "ayam", "sarden", "lauk", "makan", "jajan", "sambal", "gula", "gorengan",
  ],
  data: ["kuota", "paket data", "paket", "data", "pulsa", "internet"],
  darurat: ["sabun", "odol", "pasta gigi", "sikat gigi", "laundry", "londri", "sampo", "shampoo", "deterjen", "detergen", "tisu", "kos"],
};

export function mergeDictionary(base: CategoryDictionary, extra: CategoryDictionary): CategoryDictionary {
  const out: CategoryDictionary = {};
  for (const k of new Set([...Object.keys(base), ...Object.keys(extra)]) as Set<EnvelopeKode>) {
    out[k] = [...new Set([...(base[k] ?? []), ...(extra[k] ?? [])].map((s) => s.toLowerCase().trim()).filter(Boolean))];
  }
  return out;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Tebak amplop dari nama item. Mengembalikan null kalau tidak ada yang cocok atau cocok ke lebih dari
 * satu amplop (bot harus bertanya, bukan menebak diam-diam).
 */
export function detectCategory(nama: string, dict: CategoryDictionary = DEFAULT_DICTIONARY): EnvelopeKode | null {
  const tokens = tokenize(nama);
  if (tokens.length === 0) return null;
  const padded = ` ${tokens.join(" ")} `;
  const hit = new Set<EnvelopeKode>();
  const phraseHit = new Set<EnvelopeKode>();
  for (const [kode, words] of Object.entries(dict) as [EnvelopeKode, string[]][]) {
    for (const w of words ?? []) {
      if (padded.includes(` ${w} `)) {
        hit.add(kode);
        if (w.includes(" ")) phraseHit.add(kode);
      }
    }
  }
  // frasa ("paket data", "mie instan") mengalahkan kata tunggal yang ambigu ("paket")
  if (phraseHit.size === 1) return [...phraseHit][0];
  return hit.size === 1 ? [...hit][0] : null;
}
