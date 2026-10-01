"use client";

import { useState } from "react";
import { rp } from "@/lib/money";
import { niceTicks, rpAxis, useWidth } from "./useWidth";

export interface StackSeries {
  key: string;
  label: string;
  color: string;
}

interface Props {
  labels: string[];
  series: StackSeries[];
  /** data[i][key] */
  data: Record<string, number>[];
  height?: number;
  title: string;
  /** garis referensi horizontal (mis. rata-rata jatah) */
  refLine?: { value: number; label: string };
}

/** Kolom bertumpuk: maksimal 24px, celah 2px antar segmen, ujung atas membulat 4px, tooltip per kolom. */
export default function StackedColumns({ labels, series, data, height = 240, title, refLine }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { t: 14, r: refLine ? Math.max(52, Math.round(refLine.label.length * 6.6) + 14) : 12, b: 28, l: 44 };
  const iw = width - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const totals = data.map((d) => series.reduce((s, x) => s + (d[x.key] ?? 0), 0));
  const ticks = niceTicks(Math.max(1, ...totals, refLine?.value ?? 0));
  const top = ticks[ticks.length - 1];
  const band = iw / Math.max(1, labels.length);
  const bw = Math.min(24, band * 0.6);
  const y = (v: number) => pad.t + ih - (v / top) * ih;
  const GAP = 2;

  return (
    <div ref={ref} className="relative w-full">
      <svg width={width} height={height} role="img" aria-label={title} className="block">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth={1} />
            <text x={pad.l - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-[var(--muted)] text-[11px] num">
              {rpAxis(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = pad.l + band * i + band / 2;
          let acc = 0;
          const segs = series.filter((s) => (d[s.key] ?? 0) > 0);
          return (
            <g key={labels[i] + i} opacity={hover === null || hover === i ? 1 : 0.45}>
              {segs.map((s, j) => {
                const v = d[s.key];
                const y0 = y(acc);
                acc += v;
                const y1 = y(acc);
                const h = Math.max(0, y0 - y1 - (j > 0 ? GAP : 0));
                const isTop = j === segs.length - 1;
                const r = isTop ? Math.min(4, h / 2, bw / 2) : 0;
                const x0 = cx - bw / 2;
                const yb = y0 - (j > 0 ? GAP : 0);
                const pathD = `M${x0},${yb} V${yb - h + r} Q${x0},${yb - h} ${x0 + r},${yb - h} H${x0 + bw - r} Q${x0 + bw},${yb - h} ${x0 + bw},${yb - h + r} V${yb} Z`;
                return <path key={s.key} d={pathD} fill={s.color} />;
              })}
              {totals[i] > 0 && (labels.length <= 8 || hover === i) && (
                <text x={cx} y={y(totals[i]) - 6} textAnchor="middle" className="fill-[var(--fg-2)] text-[10.5px] font-medium num">
                  {rpAxis(totals[i])}
                </text>
              )}
              <text x={cx} y={height - 8} textAnchor="middle" className="fill-[var(--muted)] text-[11px]">
                {labels[i]}
              </text>
              <rect x={cx - band / 2} y={pad.t} width={band} height={ih} fill="transparent" onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} />
            </g>
          );
        })}
        {refLine && (
          <g>
            <line x1={pad.l} x2={width - pad.r} y1={y(refLine.value)} y2={y(refLine.value)} stroke="var(--fg-2)" strokeWidth={1} strokeOpacity={0.6} />
            <text x={width - pad.r + 6} y={y(refLine.value)} dy="0.32em" className="fill-[var(--fg-2)] text-[11px] font-medium">
              {refLine.label}
            </text>
          </g>
        )}
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute top-1 z-10 min-w-44 rounded-xl border border-line bg-card px-3 py-2 text-xs shadow-lg"
          style={{ left: Math.min(Math.max(pad.l + band * hover + band / 2 - 88, 0), width - 184) }}
        >
          <p className="mb-1 font-semibold">{labels[hover]}</p>
          {series.map((s) => (
            <p key={s.key} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-fg-2">
                <span className="inline-block size-2.5 rounded-sm" style={{ background: s.color }} />
                {s.label}
              </span>
              <span className="num">{rp(data[hover][s.key] ?? 0)}</span>
            </p>
          ))}
          {series.length > 1 && (
            <p className="mt-1 flex justify-between border-t border-line pt-1 font-semibold">
              <span>Total</span>
              <span className="num">{rp(totals[hover])}</span>
            </p>
          )}
        </div>
      )}
      {series.length > 1 && (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-2" aria-label="Legenda">
          {series.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span className="inline-block size-2.5 rounded-sm" style={{ background: s.color }} />
              {s.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
