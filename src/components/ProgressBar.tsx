import { TONE_BG, type Tone } from "@/lib/format";

export default function ProgressBar({ persen, tone = "ok", label }: { persen: number; tone?: Tone | "brand"; label?: string }) {
  const p = Math.max(0, Math.min(100, persen));
  const warna = tone === "brand" ? "bg-brand" : TONE_BG[tone];
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(p)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className="h-2.5 w-full overflow-hidden rounded-full bg-line"
    >
      <div className={`h-full rounded-full ${warna}`} style={{ width: `${p}%` }} />
    </div>
  );
}
