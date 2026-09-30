import type { EnvelopeKode } from "./types";

export type Alloc = Record<EnvelopeKode, number>;

export interface PlanInput {
  income: number;
  /** rencana pembagian untuk periode ini (total bisa tidak sama dengan income) */
  plan: Alloc;
  /** urutan amplop yang boleh dipotong saat uang kurang */
  urutanPotong?: EnvelopeKode[];
  /** hari sampai tagihan paylater berikutnya; null = tidak ada tagihan */
  hariKeTagihan?: number | null;
}

export interface PlanResult {
  alloc: Alloc;
  /** yang dipotong dari rencana, sesuai urutan */
  potongan: { kode: EnvelopeKode; nominal: number }[];
  /** uang lebih dari rencana (dibagi 50/50 kado/darurat) */
  lebih: number;
  /** total kekurangan dibanding rencana sebelum dipotong */
  kurangAwal: number;
  /** kekurangan yang tidak bisa ditutup tanpa menyentuh Makan/Data (perlu keputusan manual) */
  kurangTersisa: number;
  /** berapa Tabungan kado berkurang dibanding rencana */
  kadoBerkurang: number;
}

export const URUTAN_POTONG_DEFAULT: EnvelopeKode[] = ["darurat", "kado", "paylater"];
const JEDA_PAYLATER_HARI = 14;

/**
 * Bagi uang masuk ke amplop.
 * - Uang lebih: 50% Tabungan kado (kalau kado masih aktif), sisanya Darurat.
 * - Uang kurang: potong Darurat dulu, lalu Kado, lalu Paylater (hanya kalau tagihan berikutnya > 14 hari).
 *   Makan dan Paket data tidak pernah dipotong otomatis.
 */
export function planAllocation({ income, plan, urutanPotong = URUTAN_POTONG_DEFAULT, hariKeTagihan = null }: PlanInput): PlanResult {
  const alloc: Alloc = { ...plan };
  const total = Object.values(plan).reduce((a, b) => a + b, 0);
  const potongan: PlanResult["potongan"] = [];
  let lebih = 0;
  let kurang = 0;
  let kurangAwal = 0;

  if (income >= total) {
    lebih = income - total;
    const kadoAktif = plan.kado > 0;
    const keKado = kadoAktif ? Math.floor(lebih / 2) : 0;
    alloc.kado += keKado;
    alloc.darurat += lebih - keKado;
  } else {
    kurang = total - income;
    kurangAwal = kurang;
    for (const kode of urutanPotong) {
      if (kurang <= 0) break;
      if (kode === "paylater" && hariKeTagihan !== null && hariKeTagihan <= JEDA_PAYLATER_HARI) continue;
      const potong = Math.min(kurang, alloc[kode]);
      if (potong <= 0) continue;
      alloc[kode] -= potong;
      kurang -= potong;
      potongan.push({ kode, nominal: potong });
    }
  }

  return {
    alloc,
    potongan,
    lebih,
    kurangAwal,
    kurangTersisa: kurang,
    kadoBerkurang: potongan.find((p) => p.kode === "kado")?.nominal ?? 0,
  };
}
