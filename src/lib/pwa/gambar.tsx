import { ImageResponse } from "next/og";

/** Warna merek (sama dengan --brand di globals.css). */
export const BRAND = "#0f766e";
const TERANG = { bg: "#f6f7f9", fg: "#0e1726", muted: "#6b7686" };
const GELAP = { bg: "#0c1117", fg: "#e8edf3", muted: "#8a96a5" };

/** Logo dompet DompetKos (garis putih) sebagai SVG untuk dirender jadi PNG. */
function Dompet({ ukuran }: { ukuran: number }) {
  return (
    <svg width={ukuran} height={ukuran} viewBox="0 0 64 64">
      <path d="M14 24h36a4 4 0 0 1 4 4v18a4 4 0 0 1-4 4H14a4 4 0 0 1-4-4V28a4 4 0 0 1 4-4Zm0 0 28-10v10" fill="none" stroke="#fff" strokeWidth={3.5} strokeLinejoin="round" />
      <circle cx="44" cy="37" r="3.2" fill="#fff" />
    </svg>
  );
}

/**
 * Ikon aplikasi persegi penuh (iOS & Android membulatkan sudutnya sendiri; jangan transparan).
 * `aman` = proporsi logo terhadap kanvas (ikon maskable butuh margin lebih besar).
 */
export function ikonPng(ukuran: number, aman = 0.78) {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: BRAND }}>
        <Dompet ukuran={Math.round(ukuran * aman)} />
      </div>
    ),
    { width: ukuran, height: ukuran },
  );
}

/** Layar pembuka (splash) iOS saat aplikasi dibuka dari Layar Utama. */
export function splashPng(w: number, h: number, gelap: boolean) {
  const t = gelap ? GELAP : TERANG;
  const logo = Math.round(Math.min(w, h) * 0.24);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: t.bg }}>
        <div style={{ width: logo, height: logo, borderRadius: logo * 0.24, background: BRAND, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Dompet ukuran={Math.round(logo * 0.8)} />
        </div>
        <div style={{ marginTop: logo * 0.28, fontSize: logo * 0.3, fontWeight: 700, color: t.fg, letterSpacing: -1 }}>DompetKos</div>
        <div style={{ marginTop: logo * 0.06, fontSize: logo * 0.13, color: t.muted }}>Budget mingguan sistem amplop</div>
      </div>
    ),
    { width: w, height: h },
  );
}
