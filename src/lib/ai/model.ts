/** Pilihan penyedia & model untuk dropdown di halaman Asisten (aman dipakai komponen klien: tanpa impor server). */

export type KodePenyedia = "claude" | "gemini" | "openrouter" | "groq";

export interface OpsiModel {
  v: string;
  l: string;
}

/** Satu penyedia yang sudah tersambung dan bisa dipilih. `modelDefault` = model dari pengaturan (dipakai kalau tidak memilih model). */
export interface OpsiPenyedia {
  kode: KodePenyedia;
  label: string;
  modelDefault: string;
  model: OpsiModel[];
}

export const MODEL_CLAUDE: OpsiModel[] = [
  { v: "sonnet", l: "Sonnet (seimbang)" },
  { v: "opus", l: "Opus (paling pintar, kuota lebih boros)" },
  { v: "haiku", l: "Haiku (cepat & hemat)" },
  { v: "fable", l: "Fable" },
];

/** Seri 2.5 sudah ditutup untuk akun baru; model aktif dari pengaturan selalu ikut ditambahkan di halaman. */
export const MODEL_GEMINI: OpsiModel[] = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.8-flash"].map((v) => ({ v, l: v }));

/** Model Groq yang umum dipakai (model aktif dari pengaturan & daftar dari Groq ikut ditambahkan di halaman). */
export const MODEL_GROQ: OpsiModel[] = ["llama-3.3-70b-versatile", "openai/gpt-oss-120b", "openai/gpt-oss-20b", "llama-3.1-8b-instant"].map((v) => ({ v, l: v }));

/** Gabungkan model aktif dari pengaturan ke daftar (tanpa duplikat), model aktif di urutan pertama. */
export function denganAktif(daftar: OpsiModel[], aktif: string): OpsiModel[] {
  if (!aktif || daftar.some((m) => m.v === aktif)) return daftar;
  return [{ v: aktif, l: aktif }, ...daftar];
}

/** Satu baris "kesehatan model" (statistik belajar otomatis) untuk panel Koneksi. Status dihitung di server. */
export interface BarisStatModel {
  penyedia: string;
  model: string;
  ok: number;
  gagal: number;
  /** rata-rata lama jawab model yang sukses (ms); 0 = belum ada */
  ms: number;
  status: "sehat" | "sempat_gagal" | "ditahan" | "ditutup";
  /** kapan model boleh dicoba lagi (sudah diformat WIB); null kalau tidak ditahan */
  bolehLagi: string | null;
}
