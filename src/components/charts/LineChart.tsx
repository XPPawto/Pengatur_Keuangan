"use client";

import { useState } from "react";
import { rp } from "@/lib/money";
import { niceTicks, rpAxis, useWidth } from "./useWidth";

export interface LineSeries {
  key: string;
  label: string;
  color: string;
  values: (number | null)[];
}

interface Props {
  labels: string[];
  series: LineSeries[];
  refs?: { value: number; label: string }[];
  height?: number;
  title: string;
}

/** Grafik garis kumulatif: garis 2px, titik ujung ber-cincin, crosshair + tooltip, garis referensi target. */
export default function LineChart({ labels, series, refs = [], height = 260, title }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { t: 16, r: 64, b: 28, l: 44 };
  const iw = width - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const max = Math.max(1, ...series.flatMap((s) => s.values.filter((v): v is number => v !== null)), ...refs.map((r) => r.value));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  const x = (i: number) => pad.l + (labels.length <= 1 ? iw / 2 : (i / (labels.length - 1)) * iw);
  const y = (v: number) => pad.t + ih - (v / top) * ih;

  const path = (vals: (number | null)[]) => {
    let d = "";
    vals.forEach((v, i) => {
      if (v === null) return;
      d += `${d && vals[i - 1] !== null ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    });
    return d;
  };

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - box.left;
    const i = Math.round((px / box.width) * (labels.length - 1));
    setHover(Math.max(0, Math.min(labels.length - 1, i)));
  };

  return (
    <div ref={ref} className="relative w-full">
      <svg width={width} height={height} role="img" aria-label={title} className="block overflow-visible">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth={1} />
            <text x={pad.l - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-[var(--muted)] text-[11px] num">
              {rpAxis(t)}
            </text>
          </g>
        ))}
        {labels.map((l, i) =>
          labels.length <= 8 || i % Math.ceil(labels.length / 6) === 0 || i === labels.length - 1 ? (
            <text key={l + i} x={x(i)} y={height - 8} textAnchor="middle" className="fill-[var(--muted)] text-[11px]">
              {l}
            </text>
          ) : null,
        )}
        {refs.map((r) => (
          <g key={r.label}>
            <line x1={pad.l} x2={width - pad.r} y1={y(r.value)} y2={y(r.value)} stroke="var(--line-strong)" strokeWidth={1} />
            <text x={width - pad.r + 6} y={y(r.value)} dy="0.32em" className="fill-[var(--fg-2)] text-[11px] font-medium">
              {r.label}
            </text>
          </g>
        ))}
        {series.map((s) => (
          <path key={s.key} d={path(s.values)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {series.map((s) => {
          const last = s.values.reduce<number>((acc, v, i) => (v !== null ? i : acc), -1);
          if (last < 0) return null;
          return <circle key={s.key} cx={x(last)} cy={y(s.values[last]!)} r={4.5} fill={s.color} stroke="var(--card)" strokeWidth={2} />;
        })}
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} stroke="var(--line-strong)" strokeWidth={1} />
            {series.map((s) =>
              s.values[hover] !== null ? <circle key={s.key} cx={x(hover)} cy={y(s.values[hover]!)} r={4.5} fill={s.color} stroke="var(--card)" strokeWidth={2} /> : null,
            )}
          </g>
        )}
        <rect x={pad.l} y={pad.t} width={iw} height={ih} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute top-2 z-10 min-w-40 rounded-xl border border-line bg-card px-3 py-2 text-xs shadow-lg"
          style={{ left: Math.min(Math.max(x(hover) - 80, 0), width - 170) }}
        >
          <p className="mb-1 font-semibold">{labels[hover]}</p>
          {series.map((s) => (
            <p key={s.key} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-fg-2">
                <span className="inline-block h-0.5 w-3 rounded" style={{ background: s.color }} />
                {s.label}
              </span>
              <span className="num font-semibold">{s.values[hover] === null ? "–" : rp(s.values[hover]!)}</span>
            </p>
          ))}
        </div>
      )}
      <ul className="mt-2 flex flex-wrap gap-4 text-xs text-fg-2" aria-label="Legenda">
        {series.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 rounded" style={{ background: s.color }} />
            {s.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
