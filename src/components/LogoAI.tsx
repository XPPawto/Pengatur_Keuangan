import { useId } from "react";

/*
 * Logo resmi penyedia AI (Claude, Gemini, OpenRouter), digambar inline sebagai SVG supaya tajam di semua ukuran,
 * tidak perlu memuat gambar dari luar (CSP tetap ketat), dan logo OpenRouter mengikuti warna teks (terang/gelap).
 * Bentuk diambil dari lobe-icons (MIT License, (c) 2023 LobeHub). Merek dagang milik pemiliknya masing-masing.
 */

const GEMINI = "M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z";
const GRADASI_GEMINI = [
  { x1: 7, x2: 11, y1: 15.5, y2: 12, warna: "#08B962", akhir: 1 },
  { x1: 8, x2: 11.5, y1: 5.5, y2: 11, warna: "#F94543", akhir: 1 },
  { x1: 3.5, x2: 17.5, y1: 13.5, y2: 12, warna: "#FABC12", akhir: 0.46 },
];
const CLAUDE = "M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z";
const OPENROUTER = "M18.654 3.87a5.087 5.087 0 110 10.174L23.7 19.09c.64.641.187 1.737-.72 1.737H8.48a8.479 8.479 0 010-16.958h10.175zM8.479 7.26a5.087 5.087 0 100 10.176 5.087 5.087 0 000-10.175z";

const GROQ = "M12.036 2c-3.853-.035-7 3-7.036 6.781-.035 3.782 3.055 6.872 6.908 6.907h2.42v-2.566h-2.292c-2.407.028-4.38-1.866-4.408-4.23-.029-2.362 1.901-4.298 4.308-4.326h.1c2.407 0 4.358 1.915 4.365 4.278v6.305c0 2.342-1.944 4.25-4.323 4.279a4.375 4.375 0 01-3.033-1.252l-1.851 1.818A7 7 0 0012.029 22h.092c3.803-.056 6.858-3.083 6.879-6.816v-6.5C18.907 4.963 15.817 2 12.036 2z";

export type PenyediaLogo = "claude" | "gemini" | "openrouter" | "groq";

export function LogoClaude({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d={CLAUDE} fill="#D97757" />
    </svg>
  );
}

export function LogoGemini({ size = 18 }: { size?: number }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        {GRADASI_GEMINI.map((g, i) => (
          <linearGradient key={i} id={`${id}-${i}`} gradientUnits="userSpaceOnUse" x1={g.x1} x2={g.x2} y1={g.y1} y2={g.y2}>
            <stop stopColor={g.warna} />
            <stop offset={g.akhir} stopColor={g.warna} stopOpacity={0} />
          </linearGradient>
        ))}
      </defs>
      <path d={GEMINI} fill="#3186FF" />
      {GRADASI_GEMINI.map((_, i) => (
        <path key={i} d={GEMINI} fill={`url(#${id}-${i})`} />
      ))}
    </svg>
  );
}

export function LogoOpenRouter({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d={OPENROUTER} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}

/** Ikon "g" putih dalam lingkaran oranye-merah Groq (#F05237, warna dari logo resminya). */
export function LogoGroq({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="12" fill="#F05237" />
      <path d={GROQ} fill="#fff" fillRule="evenodd" transform="translate(12 12) scale(.6) translate(-12 -12)" />
    </svg>
  );
}

export function LogoPenyedia({ penyedia, size }: { penyedia: PenyediaLogo; size?: number }) {
  if (penyedia === "groq") return <LogoGroq size={size} />;
  if (penyedia === "claude") return <LogoClaude size={size} />;
  if (penyedia === "gemini") return <LogoGemini size={size} />;
  return <LogoOpenRouter size={size} />;
}
