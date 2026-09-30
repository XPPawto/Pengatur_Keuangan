/**
 * Semua tanggal kalender memakai WIB (UTC+7, tanpa DST). Tanggal disimpan sebagai string "YYYY-MM-DD".
 */
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
export const HARI = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

function shifted(d: Date): Date {
  return new Date(d.getTime() + WIB_OFFSET_MS);
}

/** Tanggal WIB dari sebuah instan waktu. */
export function wibDate(d: Date = new Date()): string {
  return shifted(d).toISOString().slice(0, 10);
}

/** Jam (0–23) dan menit WIB. */
export function wibHM(d: Date = new Date()): { jam: number; menit: number } {
  const s = shifted(d);
  return { jam: s.getUTCHours(), menit: s.getUTCMinutes() };
}

/** Hari dalam minggu WIB: 0 = Minggu ... 6 = Sabtu. */
export function wibWeekday(d: Date = new Date()): number {
  return shifted(d).getUTCDay();
}

function toUtcMs(date: string): number {
  const [y, m, dd] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, dd);
}

export function addDays(date: string, n: number): string {
  return new Date(toUtcMs(date) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Selisih hari (b - a). */
export function diffDays(a: string, b: string): number {
  return Math.round((toUtcMs(b) - toUtcMs(a)) / DAY_MS);
}

export function weekdayOf(date: string): number {
  return new Date(toUtcMs(date)).getUTCDay();
}

/** Minggu terakhir pada/sebelum tanggal ini (awal periode Minggu–Sabtu). */
export function sundayOnOrBefore(date: string): string {
  return addDays(date, -weekdayOf(date));
}

/** Instan UTC untuk sebuah tanggal+jam WIB. */
export function fromWib(date: string, jam = 0, menit = 0): Date {
  return new Date(toUtcMs(date) + (jam * 60 + menit) * 60 * 1000 - WIB_OFFSET_MS);
}

/** "4 Okt" */
export function fmtTanggal(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${d} ${BULAN[m - 1]}`;
}

/** "4 Okt 2026" */
export function fmtTanggalPanjang(date: string): string {
  return `${fmtTanggal(date)} ${date.slice(0, 4)}`;
}

/** "4–10 Okt" atau "28 Okt–3 Nov" */
export function fmtRentang(mulai: string, selesai: string): string {
  const [, m1, d1] = mulai.split("-").map(Number);
  const [, m2, d2] = selesai.split("-").map(Number);
  return m1 === m2 ? `${d1}–${d2} ${BULAN[m2 - 1]}` : `${d1} ${BULAN[m1 - 1]}–${d2} ${BULAN[m2 - 1]}`;
}

export function namaHari(date: string): string {
  return HARI[weekdayOf(date)];
}
