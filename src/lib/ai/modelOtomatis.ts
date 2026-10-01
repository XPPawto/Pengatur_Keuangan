import type { Db } from "../db";
import type { HasilClaude } from "./claude";
import { masalahModel } from "./openrouter";

/**
 * Pemilihan model otomatis untuk penyedia cadangan (Gemini, OpenRouter).
 *
 * Model gratis sering penuh ("high demand"), timeout, atau ditutup. Supaya balasan tetap datang:
 * - model pilihan pemilik dicoba duluan; kalau gagal karena modelnya (bukan akun/kunci), pindah ke model berikutnya
 * - hasil tiap model dicatat (sukses, gagal berturut-turut, kecepatan rata-rata) di Setting `ai_model_statistik`
 * - model yang baru gagal ditahan sementara (penuh/timeout: 3 menit, lipat dua tiap gagal berturut-turut, maks 30 menit;
 *   ditutup/tidak ditemukan: 24 jam), lalu dicoba lagi otomatis
 * - cadangan diurutkan dari yang terbukti sukses dan tercepat, lalu yang belum pernah dicoba
 */

export type JenisGagalModel = "rusak" | "sementara";

export interface StatModel {
  ok: number;
  gagal: number;
  /** gagal beruntun sejak sukses terakhir */
  berturut: number;
  /** rata-rata (EWMA) lama jawab model yang sukses, ms; 0 = belum ada */
  ms: number;
  /** waktu terakhir dicoba (ISO), untuk membuang statistik lama */
  terakhir: string;
  /** model tidak dicoba sebelum waktu ini (ISO) */
  tahanSampai?: string;
  /** penyebab masa tahan: penuh/timeout (sementara) atau ditutup/tidak ada (rusak) */
  jenis?: JenisGagalModel;
}

const KUNCI = "ai_model_statistik";
const TAHAN_RUSAK_MS = 24 * 3600_000;
const TAHAN_SEMENTARA_DASAR_MS = 3 * 60_000;
const TAHAN_SEMENTARA_MAKS_MS = 30 * 60_000;
const SIMPAN_HARI = 30;
const MAKS_ENTRI = 60;

const kunciModel = (penyedia: string, model: string) => `${penyedia}|${model}`;

export async function bacaStatistik(db: Db): Promise<Record<string, StatModel>> {
  const row = await db.setting.findUnique({ where: { kunci: KUNCI } });
  try {
    const isi = row ? (JSON.parse(row.nilai) as Record<string, StatModel>) : {};
    return isi && typeof isi === "object" ? isi : {};
  } catch {
    return {};
  }
}

/** Masa tunggu setelah `berturut` kali gagal sementara beruntun. */
export function tahanSementaraMs(berturut: number): number {
  return Math.min(TAHAN_SEMENTARA_MAKS_MS, TAHAN_SEMENTARA_DASAR_MS * 2 ** Math.max(0, berturut - 1));
}

/**
 * Catat hasil satu percobaan model. `jenis` = penyebab gagal yang terkait modelnya (null = masalah akun/kunci/batas:
 * bukan salah modelnya, jadi tidak menahan model).
 */
export async function catatModel(db: Db, penyedia: string, model: string, hasil: { ok: boolean; durasiMs: number }, jenis: JenisGagalModel | null, now: Date) {
  const semua = await bacaStatistik(db);
  const k = kunciModel(penyedia, model);
  const lama: StatModel = semua[k] ?? { ok: 0, gagal: 0, berturut: 0, ms: 0, terakhir: now.toISOString() };
  const baru: StatModel = { ...lama, terakhir: now.toISOString() };
  if (hasil.ok) {
    baru.ok += 1;
    baru.berturut = 0;
    baru.ms = lama.ms ? Math.round(lama.ms * 0.7 + hasil.durasiMs * 0.3) : Math.round(hasil.durasiMs);
    delete baru.tahanSampai;
    delete baru.jenis;
  } else if (jenis) {
    baru.gagal += 1;
    baru.berturut += 1;
    const tahan = jenis === "rusak" ? TAHAN_RUSAK_MS : tahanSementaraMs(baru.berturut);
    baru.tahanSampai = new Date(now.getTime() + tahan).toISOString();
    baru.jenis = jenis;
  } else {
    return; // masalah akun/kunci: tidak mengubah apa pun soal model ini
  }
  semua[k] = baru;

  // buang statistik lama & batasi ukuran
  const batas = now.getTime() - SIMPAN_HARI * 86400_000;
  const sisa = Object.entries(semua)
    .filter(([, s]) => new Date(s.terakhir).getTime() >= batas)
    .sort((a, b) => b[1].terakhir.localeCompare(a[1].terakhir))
    .slice(0, MAKS_ENTRI);
  const nilai = JSON.stringify(Object.fromEntries(sisa));
  await db.setting.upsert({ where: { kunci: KUNCI }, update: { nilai }, create: { kunci: KUNCI, nilai } });
}

const dalamTahanan = (s: StatModel | undefined, now: Date) => !!s?.tahanSampai && new Date(s.tahanSampai) > now;

/** Model ini sedang ditahan (baru gagal karena modelnya) dan belum boleh dicoba lagi. */
export const sedangDitahan = (penyedia: string, model: string, stat: Record<string, StatModel>, now: Date) => dalamTahanan(stat[kunciModel(penyedia, model)], now);

/**
 * Susun urutan model yang dicoba:
 * 1. `utama` (pilihan pemilik) kalau tidak sedang ditahan
 * 2. model yang terbukti sukses (tanpa gagal beruntun), dari yang tercepat
 * 3. model yang belum pernah dicoba, sesuai urutan `calon`
 * 4. model yang pernah gagal tapi masa tahannya sudah lewat
 * Model yang masih ditahan dilewati. Kalau semuanya ditahan, kembalikan satu yang paling cepat habis masa tahannya
 * (lebih baik mencoba daripada tidak menjawab sama sekali).
 */
export function urutkanModel(penyedia: string, calon: string[], utama: string | undefined, stat: Record<string, StatModel>, now: Date): string[] {
  const unik = [...new Set(calon.filter(Boolean))];
  const s = (m: string) => stat[kunciModel(penyedia, m)];
  const aktif = unik.filter((m) => !dalamTahanan(s(m), now));
  if (!aktif.length) {
    const tercepat = [...unik].sort((a, b) => (s(a)?.tahanSampai ?? "").localeCompare(s(b)?.tahanSampai ?? ""))[0];
    return tercepat ? [tercepat] : [];
  }
  const terbukti = aktif.filter((m) => m !== utama && (s(m)?.ok ?? 0) > 0 && (s(m)?.berturut ?? 0) === 0).sort((a, b) => (s(a)!.ms || Infinity) - (s(b)!.ms || Infinity));
  const baru = aktif.filter((m) => m !== utama && !s(m));
  const pernahGagal = aktif.filter((m) => m !== utama && s(m) && !terbukti.includes(m));
  return [...(utama && aktif.includes(utama) ? [utama] : []), ...terbukti, ...baru, ...pernahGagal];
}

/**
 * Apakah kegagalan ini salah modelnya (lanjut ke model lain) atau masalah akun/kunci/batas harian (berhenti)?
 * `rusak` = model ditutup / tidak ada / ditolak akun; `sementara` = penuh, timeout, kena batas per model.
 */
export function jenisGagal(penyedia: "gemini" | "openrouter", h: HasilClaude): JenisGagalModel | null {
  if (h.ok) return null;
  if (h.alasan === "belum_login" || h.alasan === "belum_diatur" || h.alasan === "dimatikan" || h.alasan === "kuota") return null;
  if (penyedia === "openrouter") {
    const m = masalahModel(h.pesan);
    if (m) return m;
    // batas harian OpenRouter (limit) berlaku untuk akun, bukan modelnya: berhenti. Timeout/penuh: coba model lain.
    return h.alasan === "timeout" || h.alasan === "sibuk" ? "sementara" : null;
  }
  if (/no longer available|not found|NOT_FOUND|is not supported|not supported for/i.test(h.pesan)) return "rusak";
  // Gemini: kuota gratis dihitung per model, jadi 429 pada satu model tidak berarti model lain ikut habis
  if (h.alasan === "sibuk" || h.alasan === "timeout" || h.alasan === "limit") return "sementara";
  return null;
}

/** Calon model Gemini (urutan kualitas/kestabilan hasil uji). Model pilihan pemilik selalu dicoba duluan. */
export const CALON_GEMINI = ["gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.5-flash", "gemini-3.8-flash"];
/** Untuk tugas kecil (tebak kategori, review): yang ringan dulu. */
export const CALON_GEMINI_RINGAN = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.6-flash", "gemini-3.5-flash"];

/**
 * Calon model Gemini berurutan. Kalau daftar dari Google (`ditemukan`) tersedia: model teruji yang masih terdaftar
 * didahulukan (dijamin sudah pernah dites), lalu model baru yang ditemukan (versi terbaru dulu; untuk tugas kecil
 * yang "lite" dulu). Kalau tidak tersedia: daftar tetap. Model pilihan pemilik selalu paling depan.
 */
export function calonGemini(ringan: boolean, utama: string | undefined, ditemukan: string[] | null): string[] {
  const dasar = ringan ? CALON_GEMINI_RINGAN : CALON_GEMINI;
  if (!ditemukan?.length) return [utama ?? "", ...dasar];
  const ada = new Set(ditemukan);
  const lite = (m: string) => (m.endsWith("-lite") ? 0 : 1);
  const baru = ditemukan.filter((m) => !CALON_GEMINI.includes(m) && !CALON_GEMINI_RINGAN.includes(m));
  if (ringan) baru.sort((a, b) => lite(a) - lite(b));
  return [utama ?? "", ...dasar.filter((m) => ada.has(m)), ...baru];
}
