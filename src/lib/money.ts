/** Format Rupiah: 12500 -> "Rp12.500", -5000 -> "-Rp5.000". */
export function rp(n: number): string {
  const v = Math.round(n);
  const s = Math.abs(v)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${v < 0 ? "-" : ""}Rp${s}`;
}

/** Versi singkat untuk teks chat: 25000 -> "25rb". */
export function rpShort(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (a >= 1_000_000) return `${sign}${trim(a / 1_000_000)}jt`;
  if (a >= 1000) return `${sign}${trim(a / 1000)}rb`;
  return `${sign}${a}`;
}

function trim(x: number): string {
  return (Math.round(x * 10) / 10).toString().replace(".", ",");
}

/** Jatah harian: sisa / jumlah hari, dibulatkan ke bawah ke ratusan. Tidak pernah negatif. */
export function jatahHarian(sisa: number, hariSisa: number): number {
  if (hariSisa <= 0 || sisa <= 0) return 0;
  return Math.floor(sisa / hariSisa / 100) * 100;
}
