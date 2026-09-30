import { TONE_BG, type Tone } from "@/lib/format";

export default function ProgressBar({ persen, tone = "ok", label, tebal = false }: { persen: number; tone?: Tone | "brand"; label?: string; tebal?: boolean }) {
  const p = Math.max(0, Math.min(100, persen));
  const warna = tone === "brand" ? "bg-brand" : TONE_BG[tone];
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(p)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={`w-full overflow-hidden rounded-full bg-subtle ${tebal ? "h-2.5" : "h-1.5"}`}
    >
      <div className={`h-full rounded-full ${warna} transition-[width] duration-500`} style={{ width: `${p}%` }} />
    </div>
  );
}
