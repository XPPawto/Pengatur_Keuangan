/** Status warna konsisten: hijau (aman), kuning (sisa < 30%), merah (lewat). */
export type Tone = "ok" | "warn" | "bad";

export function toneFor(saldo: number, alokasi: number): Tone {
  if (saldo < 0) return "bad";
  if (alokasi > 0 && saldo / alokasi < 0.3) return "warn";
  return "ok";
}

export const TONE_TEXT: Record<Tone, string> = { ok: "text-ok", warn: "text-warn", bad: "text-bad" };
export const TONE_BG: Record<Tone, string> = { ok: "bg-ok", warn: "bg-warn", bad: "bg-bad" };
export const TONE_SOFT: Record<Tone, string> = { ok: "bg-ok-bg text-ok", warn: "bg-warn-bg text-warn", bad: "bg-bad-bg text-bad" };
