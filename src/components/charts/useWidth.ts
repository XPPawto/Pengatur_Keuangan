"use client";

import { useEffect, useRef, useState } from "react";

/** Lebar elemen dalam piksel (grafik digambar sesuai lebar asli supaya teks tidak ikut mengecil). */
export function useWidth<T extends HTMLElement>(awal = 320) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(awal);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.floor(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Angka sumbu yang rapi: 0, 50rb, 100rb, … */
export function niceTicks(max: number, count = 4, bulat = false): number[] {
  if (max <= 0) return [0];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(bulat ? 1 : 0, (bulat ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10]).map((m) => m * mag).find((s) => s >= raw) ?? raw);
  const out: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) out.push(Math.round(v));
  if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
  return out;
}

export function rpAxis(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toString().replace(".", ",")}jt`;
  if (n >= 1000) return `${Math.round(n / 1000)}rb`;
  return String(n);
}
