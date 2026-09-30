export const ENVELOPE_KODE = ["makan", "data", "paylater", "kado", "darurat"] as const;
export type EnvelopeKode = (typeof ENVELOPE_KODE)[number];

export type EnvelopeJenis = "daily" | "fixed" | "sinking" | "goal" | "remainder";
export type PeriodStatus = "menunggu" | "aktif" | "selesai";
export type Sumber = "wa" | "web";

/** Kata yang harus diketik untuk membuka Tabungan kado. */
export const KATA_BUKA_KUNCI = "YAKIN AMBIL TABUNGAN";
