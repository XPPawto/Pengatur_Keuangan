"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { DataKoneksi } from "@/lib/services/koneksi";
import { Icon, Logo, type IconName } from "./icons";
import { useWidth } from "./charts/useWidth";
import { useDenyut, type LogLive } from "./useDenyut";

type IdFitur = "chat_web" | "chat_wa" | "struk" | "review" | "kategori";
type IdNode = "hub" | "wa" | "pemilik" | "keluarga" | "antrean" | "claude" | IdFitur | "fitur";
type Gaya = "aktif" | "claude" | "pakai" | "tunggu" | "putus" | "biasa" | "redup";

interface Tata {
  w: number;
  h: number;
  arah: "datar" | "tegak";
  pos: Partial<Record<IdNode, [number, number]>>;
  sisi: [IdNode, IdNode][];
}

const SISI_INTI: [IdNode, IdNode][] = [
  ["hub", "wa"],
  ["wa", "pemilik"],
  ["wa", "keluarga"],
  ["wa", "antrean"],
  ["hub", "claude"],
];

/** Tata letak lebar (desktop) dan sempit (HP). Koordinat = titik tengah node. */
const LEBAR: Tata = {
  w: 1100,
  h: 545,
  arah: "datar",
  pos: {
    hub: [540, 300],
    wa: [290, 200],
    pemilik: [115, 75],
    keluarga: [115, 350],
    antrean: [300, 485],
    claude: [780, 200],
    chat_web: [985, 70],
    chat_wa: [990, 250],
    struk: [980, 400],
    review: [800, 490],
    kategori: [590, 480],
  },
  sisi: [...SISI_INTI, ["claude", "chat_web"], ["claude", "chat_wa"], ["claude", "struk"], ["claude", "review"], ["claude", "kategori"]],
};

/** Layar sempit: fitur AI digabung jadi satu kartu daftar supaya garis tidak saling silang. */
const SEMPIT: Tata = {
  w: 420,
  h: 790,
  arah: "tegak",
  pos: {
    fitur: [210, 100],
    claude: [210, 265],
    hub: [210, 385],
    wa: [210, 505],
    pemilik: [102, 620],
    keluarga: [318, 620],
    antrean: [210, 735],
  },
  sisi: [...SISI_INTI, ["claude", "fitur"]],
};

const WARNA_GARIS: Record<Gaya, { stroke: string; lebar: number; putus?: string; alir?: boolean; op?: number }> = {
  aktif: { stroke: "var(--ok)", lebar: 2.2, alir: true },
  claude: { stroke: "var(--claude)", lebar: 2.2, alir: true },
  pakai: { stroke: "var(--claude)", lebar: 1.6, op: 0.75 },
  tunggu: { stroke: "var(--warn)", lebar: 1.8, putus: "5 5" },
  putus: { stroke: "var(--bad)", lebar: 1.6, putus: "4 6", op: 0.8 },
  biasa: { stroke: "var(--line-strong)", lebar: 1.4 },
  redup: { stroke: "var(--line-strong)", lebar: 1.2, putus: "3 5", op: 0.6 },
};

const IKON_FITUR: Record<string, IconName> = { chat_web: "bot", chat_wa: "message", struk: "camera", review: "chart", kategori: "brain" };

/** Tanda Claude (starburst sederhana), digambar sendiri sebagai SVG. */
// koordinat dibulatkan supaya HTML server & browser identik (hindari hydration mismatch)
const SINAR = Array.from({ length: 12 }, (_, i) => {
  const a = (i * Math.PI) / 6;
  const r1 = i % 2 ? 3.2 : 2.4;
  const r2 = i % 2 ? 8.6 : 10.5;
  const b = (v: number) => Math.round(v * 100) / 100;
  return [b(12 + r1 * Math.cos(a)), b(12 + r1 * Math.sin(a)), b(12 + r2 * Math.cos(a)), b(12 + r2 * Math.sin(a))];
});

function TandaClaude({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <g stroke="var(--claude)" strokeWidth="2.4" strokeLinecap="round">
        {SINAR.map(([x1, y1, x2, y2], i) => (
          <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />
        ))}
      </g>
    </svg>
  );
}

function samarNomor(n: string | null) {
  if (!n) return "nomor belum ada";
  return `+${n.slice(0, 4)}…${n.slice(-4)}`;
}

function kurva(a: [number, number], b: [number, number], arah: Tata["arah"]) {
  const [x1, y1] = a;
  const [x2, y2] = b;
  if (arah === "datar") {
    const mx = (x1 + x2) / 2;
    return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
  }
  const my = (y1 + y2) / 2;
  return `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`;
}

interface Node {
  ikon: ReactNode;
  judul: string;
  sub: string;
  href: string;
  nada?: "brand" | "claude" | "ok" | "warn" | "bad";
  /** kartu berisi daftar (dipakai "Fitur AI" di layar sempit) */
  daftar?: { ikon: IconName; label: string; nilai: string; nyala: boolean }[];
}

function bangunNode(d: DataKoneksi): Record<IdNode, Node> {
  const waNada = d.wa.status === "terhubung" && d.wa.botHidup ? "ok" : d.wa.status === "menunggu_pairing" ? "warn" : "bad";
  const waSub = !d.wa.botHidup ? "Proses bot mati" : d.wa.status === "terhubung" ? `Terhubung · ${samarNomor(d.wa.nomorBot)}` : d.wa.status === "menunggu_pairing" ? "Menunggu pairing" : "Terputus";
  const aiNada = !d.ai.aktif || !d.ai.adaToken ? undefined : d.ai.siap ? "claude" : "bad";
  const tile = (ikon: IconName, cls: string) => (
    <span className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${cls}`}>
      <Icon name={ikon} size={16} />
    </span>
  );
  const fitur = Object.fromEntries(
    d.fitur.map((f) => [
      f.kode,
      {
        ikon: tile(IKON_FITUR[f.kode] ?? "sparkles", f.aktif && d.ai.siap ? "bg-claude-soft text-claude" : "bg-subtle text-muted"),
        judul: f.label,
        sub: !f.aktif ? "Mati" : !d.ai.siap ? "Menunggu Claude" : `${f.hariIni}× hari ini`,
        href: f.kode === "chat_web" ? "/asisten" : "#pemakaian",
      } satisfies Node,
    ]),
  ) as Record<IdFitur, Node>;

  return {
    hub: {
      ikon: <Logo size={30} />,
      judul: "DompetKos",
      sub: d.wa.botHidup ? `Bot jalan · ${d.pesanHariIni.masuk} pesan masuk hari ini` : "Proses bot tidak jalan",
      href: "/sistem",
      nada: "brand",
    },
    wa: { ikon: tile("message", waNada === "ok" ? "bg-ok-bg text-ok" : waNada === "warn" ? "bg-warn-bg text-warn" : "bg-bad-bg text-bad"), judul: "WhatsApp", sub: waSub, href: "#whatsapp", nada: waNada },
    pemilik: { ikon: tile("users", "bg-subtle text-fg-2"), judul: "Pemilik", sub: `${d.nomor.pemilik} nomor · bisa catat`, href: "/pengaturan" },
    keluarga: {
      ikon: tile("shield", "bg-subtle text-fg-2"),
      judul: "Keluarga",
      sub: d.nomor.keluarga ? `${d.nomor.labelKeluarga.slice(0, 2).join(", ")} · terima laporan` : "Belum ada nomor",
      href: "/pengaturan",
    },
    antrean: { ikon: tile("send", "bg-subtle text-fg-2"), judul: "Antrean pesan", sub: `${d.antrean} menunggu · ${d.pesanHariIni.keluar} terkirim hari ini`, href: "/pengaturan" },
    claude: {
      ikon: (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-claude-soft">
          <TandaClaude />
        </span>
      ),
      judul: "Claude",
      sub: !d.ai.adaToken
        ? "Belum disambungkan"
        : d.ai.sesi5Jam !== null || d.ai.mingguan !== null
          ? `${d.ai.siap ? "" : `${d.ai.label} · `}5 jam ${Math.round(d.ai.sesi5Jam ?? 0)}% · minggu ${Math.round(d.ai.mingguan ?? 0)}%`
          : `${d.ai.label} · ${d.ai.model} · ${d.ai.pakai}/${d.ai.batas}`,
      href: "#claude",
      nada: aiNada,
    },
    ...fitur,
    fitur: {
      ikon: null,
      judul: "Fitur AI",
      sub: "",
      href: "#pemakaian",
      daftar: d.fitur.map((f) => ({ ikon: IKON_FITUR[f.kode] ?? "sparkles", label: f.label, nilai: !f.aktif ? "mati" : `${f.hariIni}×`, nyala: f.aktif && d.ai.siap })),
    },
  };
}

function gayaSisi(d: DataKoneksi, a: IdNode, b: IdNode): Gaya {
  const waNyala = d.wa.status === "terhubung" && d.wa.botHidup;
  if (a === "hub" && b === "wa") return waNyala ? "aktif" : d.wa.status === "menunggu_pairing" ? "tunggu" : "putus";
  if (a === "wa") return waNyala ? (b === "keluarga" && !d.nomor.keluarga ? "redup" : "biasa") : "redup";
  if (a === "hub" && b === "claude") return !d.ai.aktif || !d.ai.adaToken ? "redup" : d.ai.siap ? "claude" : d.ai.kondisi === "kuota" || d.ai.kondisi === "limit" ? "tunggu" : "putus";
  if (b === "fitur") {
    if (!d.ai.siap || !d.fitur.some((x) => x.aktif)) return "redup";
    return d.fitur.some((x) => x.hariIni > 0) ? "pakai" : "biasa";
  }
  const f = d.fitur.find((x) => x.kode === b);
  if (!f || !f.aktif || !d.ai.siap) return "redup";
  return f.hariIni > 0 ? "pakai" : "biasa";
}

const NADA_BORDER: Record<string, string> = {
  brand: "border-brand text-brand shadow-[0_0_0_3px_var(--brand-soft)]",
  claude: "border-claude",
  ok: "border-ok/60",
  warn: "border-warn/60",
  bad: "border-bad/60",
};

export default function PetaKoneksi({ awal }: { awal: DataKoneksi }) {
  const [d, setD] = useState(awal);
  const [ref, cw] = useWidth<HTMLDivElement>(640);
  const tata = cw < 640 ? SEMPIT : LEBAR;
  const maksTinggi = tata === LEBAR ? 520 : 820;
  const kFit = Math.min(cw / tata.w, maksTinggi / tata.h);
  const tinggi = Math.round(tata.h * kFit);
  const fit = useCallback(() => ({ k: kFit, x: (cw - tata.w * kFit) / 2, y: 0 }), [kFit, cw, tata.w]);
  const [t, setT] = useState(fit);
  const geser = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const kanvas = useRef<HTMLDivElement>(null);
  const garis = useRef(new Map<string, SVGPathElement>());
  const { jejak, berjalan, log, waktu } = useDenyut();

  // node fitur yang tidak ada di tata letak ini (HP) dipetakan ke kartu "Fitur AI"
  const petakan = (id: string) => (tata.pos[id as IdNode] ? id : "fitur");
  const titik = jejak
    .filter((j) => waktu >= j.mulai && waktu <= j.mulai + j.durasi)
    .map((j) => {
      const dari = petakan(j.dari);
      const ke = petakan(j.ke);
      if (dari === ke) return null;
      const maju = garis.current.get(`${dari}-${ke}`);
      const el = maju ?? garis.current.get(`${ke}-${dari}`);
      if (!el) return null;
      const p = (waktu - j.mulai) / j.durasi;
      const halus = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
      const L = el.getTotalLength();
      const pt = el.getPointAtLength((maju ? halus : 1 - halus) * L);
      return { id: j.id, x: pt.x, y: pt.y, warna: j.warna };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  // node yang barusan dilewati titik menyala sebentar
  const kilat = new Map<string, string>();
  for (const j of jejak) if (waktu > j.mulai + j.durasi && waktu < j.mulai + j.durasi + 500) kilat.set(petakan(j.ke), j.warna);
  const fiturJalan = new Set([...berjalan.values()].map(petakan));

  useEffect(() => setT(fit()), [fit]);

  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const r = await fetch("/api/koneksi", { cache: "no-store" });
        if (r.ok) setD(await r.json());
      } catch {
        /* coba lagi di putaran berikutnya */
      }
    }, 5000);
    return () => clearInterval(id);
  }, []);

  const zoom = useCallback(
    (f: number, cx = cw / 2, cy = tinggi / 2) =>
      setT((p) => {
        const k = Math.min(2.5, Math.max(0.3, p.k * f));
        return { k, x: cx - (cx - p.x) * (k / p.k), y: cy - (cy - p.y) * (k / p.k) };
      }),
    [cw, tinggi],
  );

  // ctrl + scroll / pinch trackpad = zoom (scroll biasa tetap menggulir halaman)
  useEffect(() => {
    const el = kanvas.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoom(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoom]);

  const node = bangunNode(d);

  return (
    <div ref={ref} className="w-full">
      <div
        ref={kanvas}
        className="peta-grid relative cursor-grab touch-pan-y overflow-hidden rounded-xl border border-line select-none active:cursor-grabbing"
        style={{ height: tinggi }}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("a,button")) return;
          geser.current = { x: e.clientX, y: e.clientY, tx: t.x, ty: t.y };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const g = geser.current;
          if (g) setT((p) => ({ ...p, x: g.tx + e.clientX - g.x, y: g.ty + e.clientY - g.y }));
        }}
        onPointerUp={() => (geser.current = null)}
        onPointerCancel={() => (geser.current = null)}
        aria-label={`Peta koneksi: WhatsApp ${d.wa.status}, Claude ${d.ai.label}`}
      >
        <div className="absolute left-0 top-0 origin-top-left" style={{ width: tata.w, height: tata.h, transform: `translate(${t.x}px, ${t.y}px) scale(${t.k})` }}>
          <svg width={tata.w} height={tata.h} className="absolute inset-0" aria-hidden="true">
            {tata.sisi.map(([a, b]) => {
              const g = WARNA_GARIS[gayaSisi(d, a, b)];
              return (
                <path
                  key={`${a}-${b}`}
                  ref={(el) => {
                    if (el) garis.current.set(`${a}-${b}`, el);
                    else garis.current.delete(`${a}-${b}`);
                  }}
                  d={kurva(tata.pos[a]!, tata.pos[b]!, tata.arah)}
                  fill="none"
                  stroke={g.stroke}
                  strokeWidth={g.lebar}
                  strokeDasharray={g.putus}
                  strokeOpacity={g.op ?? 1}
                  className={g.alir ? "garis-alir" : undefined}
                />
              );
            })}
            {titik.map((t) => (
              <g key={t.id}>
                <circle cx={t.x} cy={t.y} r={13} fill={t.warna} opacity={0.2} />
                <circle cx={t.x} cy={t.y} r={6} fill={t.warna} stroke="var(--card)" strokeWidth={1.5} />
              </g>
            ))}
          </svg>
          {(Object.keys(tata.pos) as IdNode[]).map((id) => {
            const n = node[id];
            const [x, y] = tata.pos[id]!;
            const isHub = id === "hub";
            if (n.daftar) {
              return (
                <Link key={id} href={n.href} draggable={false} className={`absolute w-[300px] -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card p-2.5 shadow-sm transition-shadow ${fiturJalan.has(id) ? "border-claude" : "border-line"}`} style={{ left: x, top: y, boxShadow: kilat.has(id) ? `0 0 0 4px color-mix(in srgb, ${kilat.get(id)} 30%, transparent)` : undefined }}>
                  <span className="mb-1.5 block px-1 text-xs font-semibold uppercase tracking-wide text-muted">{n.judul}</span>
                  <span className="grid grid-cols-1 gap-1">
                    {n.daftar.map((f) => (
                      <span key={f.label} className="flex items-center gap-2 rounded-lg px-1 py-0.5 text-[13px]">
                        <span className={`flex size-6 shrink-0 items-center justify-center rounded-md ${f.nyala ? "bg-claude-soft text-claude" : "bg-subtle text-muted"}`}>
                          <Icon name={f.ikon} size={13} />
                        </span>
                        <span className="min-w-0 flex-1 truncate font-medium">{f.label}</span>
                        <span className="num text-xs text-muted">{f.nilai}</span>
                      </span>
                    ))}
                  </span>
                </Link>
              );
            }
            return (
              <Link
                key={id}
                href={n.href}
                draggable={false}
                className={`absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-2.5 rounded-xl border bg-card px-3 py-2 shadow-sm transition hover:border-line-strong ${isHub ? "max-w-[240px]" : tata === SEMPIT ? "max-w-[190px]" : "max-w-[230px]"} ${n.nada ? NADA_BORDER[n.nada] : "border-line"} ${(id === "claude" && berjalan.size) || fiturJalan.has(id) ? "mikir border-claude" : ""}`}
                style={{ left: x, top: y, boxShadow: kilat.has(id) ? `0 0 0 4px color-mix(in srgb, ${kilat.get(id)} 30%, transparent)` : undefined }}
              >
                {n.ikon}
                <span className="min-w-0">
                  <span className={`block truncate text-sm font-semibold ${isHub ? "text-brand" : n.nada === "claude" ? "text-claude" : "text-fg"}`}>{n.judul}</span>
                  <span className="block truncate text-[11px] leading-tight text-muted">{id === "claude" && berjalan.size ? `Lagi mikir… (${berjalan.size})` : n.sub}</span>
                </span>
              </Link>
            );
          })}
        </div>

        <div className="absolute bottom-3 left-3 flex flex-col overflow-hidden rounded-xl border border-line bg-card shadow-sm">
          <button type="button" onClick={() => zoom(1.2)} className="flex size-9 items-center justify-center text-fg-2 hover:bg-subtle" aria-label="Perbesar">
            <Icon name="plus" size={17} />
          </button>
          <button type="button" onClick={() => zoom(1 / 1.2)} className="flex size-9 items-center justify-center border-t border-line text-fg-2 hover:bg-subtle" aria-label="Perkecil">
            <Icon name="minus" size={17} />
          </button>
          <button type="button" onClick={() => setT(fit())} className="flex size-9 items-center justify-center border-t border-line text-fg-2 hover:bg-subtle" aria-label="Pas layar">
            <Icon name="maximize" size={16} />
          </button>
        </div>
      </div>
      <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <Legenda warna="var(--ok)" alir label="WhatsApp tersambung" />
        <Legenda warna="var(--claude)" alir label="Claude tersambung" />
        <Legenda warna="var(--claude)" label="Fitur dipakai hari ini" op={0.75} />
        <Legenda warna="var(--warn)" putus label="Menunggu / kena batas" />
        <Legenda warna="var(--bad)" putus label="Terputus / error" />
        <li className="hidden sm:block">Geser untuk pindah · Ctrl + scroll untuk zoom</li>
      </ul>
      <AktivitasLive log={log} />
    </div>
  );
}

function Legenda({ warna, label, alir, putus, op }: { warna: string; label: string; alir?: boolean; putus?: boolean; op?: number }) {
  return (
    <li className="flex items-center gap-1.5">
      <svg width="22" height="6" aria-hidden="true">
        <line x1="1" y1="3" x2="21" y2="3" stroke={warna} strokeWidth="2" strokeDasharray={putus ? "4 3" : alir ? "6 3" : undefined} strokeOpacity={op ?? 1} className={alir ? "garis-alir" : undefined} />
      </svg>
      {label}
    </li>
  );
}

const NADA_LOG: Record<LogLive["nada"], string> = { ok: "text-ok", claude: "text-claude", bad: "text-bad", muted: "text-muted" };

/** Log aktivitas langsung di bawah peta (tanpa isi pesan). */
function AktivitasLive({ log }: { log: LogLive[] }) {
  return (
    <div className="mt-3 rounded-xl border border-line bg-card p-3">
      <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-ok opacity-60 motion-reduce:animate-none" />
          <span className="relative inline-flex size-2 rounded-full bg-ok" />
        </span>
        Aktivitas langsung
      </p>
      {log.length ? (
        <ul className="space-y-1.5" aria-live="polite">
          {log.map((l) => (
            <li key={l.id} className="flex items-center gap-2 text-sm">
              <span className="num w-16 shrink-0 text-xs text-muted">{l.waktu.toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour12: false })}</span>
              <Icon name={l.ikon} size={15} className={`shrink-0 ${NADA_LOG[l.nada]}`} />
              <span className="min-w-0 truncate">{l.teks}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">Menunggu aktivitas… Kirim pesan ke bot atau tanya asisten, nanti garisnya jalan.</p>
      )}
    </div>
  );
}
