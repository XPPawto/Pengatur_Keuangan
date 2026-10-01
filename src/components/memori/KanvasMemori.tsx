"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NodePeta, SisiPeta, TipeNode } from "@/lib/ai/petaMemori";
import { Icon } from "../icons";

/**
 * Langit memori: setiap memori adalah satu "bintang" yang tampil di kanvas.
 * - Rasi bintang: profil di inti, catatan melingkar di sekitarnya, topik obrolan sebagai debu bintang di tepi;
 *   garis rasi menghubungkan memori yang mirip.
 * - Jaring saraf: semua node (memori, topik obrolan, kata penghubung) saling tarik; sinyal merambat di sepanjang sisi.
 * Mesinnya kecil dan mandiri (tanpa pustaka): simulasi gaya sederhana + render canvas 2D dengan sprite cahaya.
 */

export type ModePeta = "rasi" | "saraf";

export const WARNA_NODE: Record<TipeNode, string> = { profil: "#fbbf24", catatan: "#7dd3fc", topik: "#c4b5fd", kata: "#5eead4" };
const WARNA_AI = "#f0abfc";
const LANGIT = "#060a16";

interface Sim {
  id: string;
  d: NodePeta;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  fase: number;
  tarik: boolean;
  ai: boolean;
}
interface Tali {
  a: Sim;
  b: Sim;
  w: number;
  jenis: SisiPeta["jenis"];
  seed: number;
}

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
};
const radius = (d: NodePeta) => (d.tipe === "profil" ? 6.5 + 5 * d.bobot : d.tipe === "catatan" ? 4.5 + 4 * d.bobot : d.tipe === "topik" ? 2.6 + 3.6 * d.bobot : 2.6);
const tampil = (t: TipeNode, mode: ModePeta) => (mode === "saraf" ? true : t !== "kata");
const kunciRingkas = (n: NodePeta[], s: SisiPeta[]) => `${n.map((x) => `${x.id}:${x.teks ?? ""}:${x.bobot.toFixed(2)}`).join("|")}#${s.length}`;

const spriteCache = new Map<string, HTMLCanvasElement>();
/** Sprite cahaya (gradien radial) per warna: jauh lebih murah daripada membuat gradien tiap frame. */
function sprite(warna: string): HTMLCanvasElement {
  let c = spriteCache.get(warna);
  if (c) return c;
  c = document.createElement("canvas");
  c.width = c.height = 96;
  const g = c.getContext("2d")!;
  const gr = g.createRadialGradient(48, 48, 0, 48, 48, 48);
  gr.addColorStop(0, `${warna}ff`);
  gr.addColorStop(0.18, `${warna}cc`);
  gr.addColorStop(0.45, `${warna}33`);
  gr.addColorStop(1, `${warna}00`);
  g.fillStyle = gr;
  g.fillRect(0, 0, 96, 96);
  spriteCache.set(warna, c);
  return c;
}

interface Props {
  node: NodePeta[];
  sisi: SisiPeta[];
  mode: ModePeta;
  onMode: (m: ModePeta) => void;
  terpilih: string | null;
  onPilih: (id: string | null) => void;
  /** node yang disorot hasil "uji ingatan"; null/kosong = tidak ada */
  sorot: Set<string> | null;
}

interface Pandang {
  x: number;
  y: number;
  k: number;
}

export default function KanvasMemori({ node, sisi, mode, onMode, terpilih, onPilih, sorot }: Props) {
  const wadah = useRef<HTMLDivElement>(null);
  const kanvas = useRef<HTMLCanvasElement>(null);
  const [penuh, setPenuh] = useState(false);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);

  // keadaan mutable untuk loop animasi (tidak memicu render React)
  const simRef = useRef(new Map<string, Sim>());
  const daftar = useRef<Sim[]>([]);
  const tali = useRef<Tali[]>([]);
  const alpha = useRef(1);
  const pandang = useRef<Pandang>({ x: 0, y: 0, k: 1 });
  const ukuran = useRef({ w: 600, h: 420, dpr: 1 });
  const modeRef = useRef(mode);
  const terpilihRef = useRef(terpilih);
  const sorotRef = useRef(sorot);
  const hoverRef = useRef<string | null>(null);
  const kotor = useRef(true);
  const fokus = useRef<{ x: number; y: number; k: number } | null>(null);
  /** peta mengikuti tata letak (muat semua node) sampai pengguna menggeser / zoom sendiri */
  const otoPas = useRef(true);
  const kelihatan = useRef(true);
  const kurangiGerak = useRef(false);
  const bintang = useRef<{ x: number; y: number; r: number; f: number; a: number }[]>([]);
  const jatuh = useRef({ mulai: -1, x: 0, y: 0, jeda: 6 });

  const ringkas = useMemo(() => kunciRingkas(node, sisi), [node, sisi]);

  const minta = useCallback(() => {
    kotor.current = true;
  }, []);

  // ---------------------------------------------------------------- simulasi

  const langkah = useCallback(() => {
    const m = modeRef.current;
    const ns = daftar.current.filter((n) => tampil(n.d.tipe, m));
    const a = alpha.current;
    const kuat = 0.3 + 0.7 * a;
    const tolak = m === "saraf" ? 1500 : 1000;
    for (let i = 0; i < ns.length; i++) {
      const p = ns[i];
      for (let j = i + 1; j < ns.length; j++) {
        const q = ns[j];
        let dx = p.x - q.x;
        let dy = p.y - q.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) {
          dx = Math.random() - 0.5;
          dy = Math.random() - 0.5;
          d2 = 0.5;
        }
        const d = Math.sqrt(d2);
        const f = Math.min(40, (tolak / d2) * kuat);
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        p.vx += fx;
        p.vy += fy;
        q.vx -= fx;
        q.vy -= fy;
        const jarakMin = p.r + q.r + 7;
        if (d < jarakMin) {
          const dorong = (jarakMin - d) * 0.08;
          p.vx += (dx / d) * dorong;
          p.vy += (dy / d) * dorong;
          q.vx -= (dx / d) * dorong;
          q.vy -= (dy / d) * dorong;
        }
      }
    }
    for (const t of tali.current) {
      if (!tampil(t.a.d.tipe, m) || !tampil(t.b.d.tipe, m)) continue;
      const dx = t.b.x - t.a.x;
      const dy = t.b.y - t.a.y;
      const d = Math.max(1, Math.hypot(dx, dy));
      const rest = m === "saraf" ? (t.jenis === "mirip" ? 90 : 75) : t.jenis === "mirip" ? 85 : 190;
      const kekuatan = (m === "saraf" ? 0.05 : t.jenis === "mirip" ? 0.035 : 0.006) * (0.4 + 0.6 * t.w);
      const f = (d - rest) * kekuatan * kuat;
      t.a.vx += (dx / d) * f;
      t.a.vy += (dy / d) * f;
      t.b.vx -= (dx / d) * f;
      t.b.vy -= (dy / d) * f;
    }
    for (const n of ns) {
      const jarak = Math.max(1, Math.hypot(n.x, n.y));
      if (m === "rasi") {
        // inti: profil; cincin tengah: catatan; debu di tepi: topik
        const target = n.d.tipe === "profil" ? 55 + 20 * hash(n.id) : n.d.tipe === "catatan" ? 175 + 40 * hash(n.id) : 320 + 50 * hash(n.id);
        const kekuatan = n.d.tipe === "topik" ? 0.012 : 0.03;
        const f = (target - jarak) * kekuatan * kuat;
        n.vx += (n.x / jarak) * f;
        n.vy += (n.y / jarak) * f;
      } else {
        n.vx -= n.x * 0.012 * kuat;
        n.vy -= n.y * 0.012 * kuat;
      }
      if (n.tarik) {
        n.vx = 0;
        n.vy = 0;
        continue;
      }
      n.vx *= 0.8;
      n.vy *= 0.8;
      n.x += n.vx;
      n.y += n.vy;
    }
    alpha.current = Math.max(kurangiGerak.current ? 0 : 0.03, a * 0.985);
  }, []);

  const hitungPas = useCallback((): Pandang | null => {
    const ns = daftar.current.filter((n) => tampil(n.d.tipe, modeRef.current));
    const { w, h } = ukuran.current;
    if (!ns.length) return { x: w / 2, y: h / 2, k: 1 };
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const n of ns) {
      x0 = Math.min(x0, n.x - n.r);
      x1 = Math.max(x1, n.x + n.r);
      y0 = Math.min(y0, n.y - n.r);
      y1 = Math.max(y1, n.y + n.r);
    }
    const pad = 46;
    const k = Math.min(1.6, Math.max(0.25, Math.min((w - pad * 2) / Math.max(40, x1 - x0), (h - pad * 2) / Math.max(40, y1 - y0))));
    return { x: w / 2 - ((x0 + x1) / 2) * k, y: h / 2 - ((y0 + y1) / 2) * k, k };
  }, []);

  /** Pusatkan: peta kembali memuat semua node dan terus mengikuti tata letak. */
  const pas = useCallback(() => {
    otoPas.current = true;
    fokus.current = null;
    if (kurangiGerak.current) {
      const t = hitungPas();
      if (t) pandang.current = t;
    }
    minta();
  }, [hitungPas, minta]);

  const tenang = useCallback(
    (n: number) => {
      alpha.current = 1;
      for (let i = 0; i < n; i++) langkah();
    },
    [langkah],
  );

  // sinkronkan simulasi dengan data baru (posisi lama dipertahankan supaya tidak melompat)
  useEffect(() => {
    const lama = simRef.current;
    const baru = new Map<string, Sim>();
    for (const d of node) {
      const ada = lama.get(d.id);
      if (ada) {
        ada.d = d;
        ada.r = radius(d);
        ada.ai = d.sumber === "asisten";
        baru.set(d.id, ada);
        continue;
      }
      const sudut = hash(`${d.id}s`) * Math.PI * 2;
      const jarak = d.tipe === "profil" ? 40 : d.tipe === "catatan" ? 170 : 300;
      baru.set(d.id, { id: d.id, d, x: Math.cos(sudut) * jarak, y: Math.sin(sudut) * jarak, vx: 0, vy: 0, r: radius(d), fase: hash(d.id) * 6.28, tarik: false, ai: d.sumber === "asisten" });
    }
    simRef.current = baru;
    daftar.current = [...baru.values()];
    tali.current = sisi.flatMap((s) => {
      const a = baru.get(s.a);
      const b = baru.get(s.b);
      return a && b ? [{ a, b, w: s.w, jenis: s.jenis, seed: hash(s.a + s.b) }] : [];
    });
    const pertama = lama.size === 0;
    if (pertama || kurangiGerak.current) {
      tenang(pertama ? 320 : 120);
      const t = hitungPas();
      if (t && pertama) pandang.current = t;
    } else alpha.current = Math.max(alpha.current, 0.7);
    minta();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ringkas]);

  useEffect(() => {
    modeRef.current = mode;
    if (kurangiGerak.current) tenang(200);
    else alpha.current = 1;
    pas();
  }, [mode, tenang, pas]);

  useEffect(() => {
    terpilihRef.current = terpilih;
    sorotRef.current = sorot;
    const n = terpilih ? simRef.current.get(terpilih) : null;
    if (n && tampil(n.d.tipe, modeRef.current)) {
      const k = Math.max(pandang.current.k, 1.1);
      otoPas.current = false;
      if (kurangiGerak.current) pandang.current = { x: ukuran.current.w / 2 - n.x * k, y: ukuran.current.h / 2 - n.y * k, k };
      else fokus.current = { x: n.x, y: n.y, k };
    }
    minta();
  }, [terpilih, sorot, minta]);

  // ---------------------------------------------------------------- gambar

  const gambar = useCallback((t: number) => {
    const c = kanvas.current;
    if (!c) return;
    const g = c.getContext("2d");
    if (!g) return;
    const { w, h, dpr } = ukuran.current;
    const m = modeRef.current;
    const pv = pandang.current;
    const gerak = !kurangiGerak.current;
    const sel = terpilihRef.current;
    const hov = hoverRef.current;
    const so = sorotRef.current && sorotRef.current.size ? sorotRef.current : null;

    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // langit
    g.fillStyle = LANGIT;
    g.fillRect(0, 0, w, h);
    const neb = (cx: number, cy: number, r: number, warna: string, a: string) => {
      const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
      gr.addColorStop(0, `${warna}${a}`);
      gr.addColorStop(1, `${warna}00`);
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    };
    neb(w * 0.22 + pv.x * 0.02, h * 0.3 + pv.y * 0.02, Math.max(w, h) * 0.6, "#4c1d95", "38");
    neb(w * 0.82 + pv.x * 0.03, h * 0.78 + pv.y * 0.03, Math.max(w, h) * 0.55, "#0e7490", "2e");
    neb(w * 0.55, h * 0.1, Math.max(w, h) * 0.4, "#1e3a8a", "26");
    for (const s of bintang.current) {
      const kelip = gerak ? 0.55 + 0.45 * Math.sin(t * s.f + s.a * 9) : 0.75;
      g.globalAlpha = s.a * kelip;
      g.fillStyle = "#dbeafe";
      g.beginPath();
      g.arc(((s.x * w + pv.x * 0.04 * s.r) % w + w) % w, ((s.y * h + pv.y * 0.04 * s.r) % h + h) % h, s.r, 0, 6.283);
      g.fill();
    }
    g.globalAlpha = 1;

    // bintang jatuh (jarang, hanya di rasi)
    if (gerak && m === "rasi") {
      const j = jatuh.current;
      if (j.mulai < 0 && t > j.jeda) {
        j.mulai = t;
        j.x = w * (0.1 + 0.6 * Math.random());
        j.y = h * (0.05 + 0.3 * Math.random());
      }
      if (j.mulai >= 0) {
        const p = (t - j.mulai) / 0.9;
        if (p >= 1) {
          j.mulai = -1;
          j.jeda = t + 7 + Math.random() * 9;
        } else {
          const x = j.x + p * 170;
          const y = j.y + p * 80;
          const gr = g.createLinearGradient(x, y, x - 70, y - 33);
          gr.addColorStop(0, `rgba(255,255,255,${0.8 * (1 - p)})`);
          gr.addColorStop(1, "rgba(255,255,255,0)");
          g.strokeStyle = gr;
          g.lineWidth = 1.4;
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x - 70, y - 33);
          g.stroke();
        }
      }
    }

    g.save();
    g.translate(pv.x, pv.y);
    g.scale(pv.k, pv.k);
    const aktifId = sel ?? hov;
    const tetangga = new Set<string>();
    if (aktifId) for (const tl of tali.current) if (tl.a.id === aktifId) tetangga.add(tl.b.id);
      else if (tl.b.id === aktifId) tetangga.add(tl.a.id);
    const redup = (id: string) => (so ? (so.has(id) ? 1 : 0.18) : aktifId && id !== aktifId && !tetangga.has(id) ? 0.45 : 1);

    // sisi
    for (const tl of tali.current) {
      if (!tampil(tl.a.d.tipe, m) || !tampil(tl.b.d.tipe, m)) continue;
      const aktif = aktifId && (tl.a.id === aktifId || tl.b.id === aktifId);
      // rasi: garis ke topik obrolan (jauh di tepi) hanya muncul saat dipilih / disorot, supaya langit tetap bersih
      if (m === "rasi" && tl.jenis === "kata" && !aktif && !(so && so.has(tl.a.id) && so.has(tl.b.id))) continue;
      const faktor = Math.min(redup(tl.a.id), redup(tl.b.id));
      const dx = tl.b.x - tl.a.x;
      const dy = tl.b.y - tl.a.y;
      const len = Math.hypot(dx, dy) || 1;
      const lengkung = m === "saraf" ? (tl.seed > 0.5 ? 1 : -1) * 0.14 * len : 0;
      const cx = (tl.a.x + tl.b.x) / 2 - (dy / len) * lengkung;
      const cy = (tl.a.y + tl.b.y) / 2 + (dx / len) * lengkung;
      const warna = tl.jenis === "mirip" ? "147,197,253" : tl.b.d.tipe === "topik" ? "196,181,253" : "94,234,212";
      g.strokeStyle = `rgba(${warna},${(aktif ? 0.8 : m === "rasi" ? 0.16 + 0.3 * tl.w : 0.12 + 0.2 * tl.w) * faktor})`;
      g.lineWidth = (aktif ? 1.8 : tl.jenis === "mirip" ? 1.1 : 0.8) / Math.max(0.8, pv.k * 0.75);
      g.beginPath();
      g.moveTo(tl.a.x, tl.a.y);
      if (m === "saraf") g.quadraticCurveTo(cx, cy, tl.b.x, tl.b.y);
      else g.lineTo(tl.b.x, tl.b.y);
      g.stroke();
      // sinyal yang merambat di jaring saraf
      if (m === "saraf" && gerak) {
        const kec = aktif ? 0.55 : 0.2;
        const p = (t * kec + tl.seed * 7) % 1;
        const u = 1 - p;
        const px = u * u * tl.a.x + 2 * u * p * cx + p * p * tl.b.x;
        const py = u * u * tl.a.y + 2 * u * p * cy + p * p * tl.b.y;
        const s = (aktif ? 16 : 9) / Math.max(0.7, pv.k);
        g.globalAlpha = (aktif ? 0.95 : 0.5) * faktor;
        g.drawImage(sprite(tl.jenis === "mirip" ? "#93c5fd" : tl.b.d.tipe === "topik" ? "#c4b5fd" : "#5eead4"), px - s / 2, py - s / 2, s, s);
        g.globalAlpha = 1;
      }
    }

    // node
    const urut = daftar.current.filter((n) => tampil(n.d.tipe, m)).sort((a, b) => (a.d.tipe === "profil" ? 1 : 0) - (b.d.tipe === "profil" ? 1 : 0) || a.r - b.r);
    for (const n of urut) {
      const warna = WARNA_NODE[n.d.tipe];
      const kelip = gerak ? 0.82 + 0.18 * Math.sin(t * (1.1 + n.fase * 0.2) + n.fase * 3) : 1;
      const dim = redup(n.id);
      const dipilih = n.id === sel;
      const hovered = n.id === hov;
      const skala = hovered ? 1.25 : dipilih ? 1.15 : 1;
      const r = n.r * skala;
      g.globalAlpha = dim * (n.d.tipe === "topik" || n.d.tipe === "kata" ? 0.55 + 0.45 * n.d.bobot : 1);
      const halo = r * (n.d.tipe === "profil" ? 7 : n.d.tipe === "catatan" ? 5.2 : 4);
      g.globalAlpha *= (n.d.tipe === "topik" || n.d.tipe === "kata" ? 0.6 : 0.85) * kelip;
      g.drawImage(sprite(warna), n.x - halo, n.y - halo, halo * 2, halo * 2);
      g.globalAlpha = dim * (n.d.tipe === "topik" || n.d.tipe === "kata" ? 0.7 + 0.3 * n.d.bobot : 1);
      g.fillStyle = "#ffffff";
      if (n.d.tipe === "profil" && m === "rasi") {
        // bintang berujung empat
        const L = r * 2.6;
        const o = r * 0.38;
        g.fillStyle = warna;
        g.beginPath();
        g.moveTo(n.x, n.y - L);
        g.quadraticCurveTo(n.x + o, n.y - o, n.x + L, n.y);
        g.quadraticCurveTo(n.x + o, n.y + o, n.x, n.y + L);
        g.quadraticCurveTo(n.x - o, n.y + o, n.x - L, n.y);
        g.quadraticCurveTo(n.x - o, n.y - o, n.x, n.y - L);
        g.fill();
        g.fillStyle = "#fffbeb";
        g.beginPath();
        g.arc(n.x, n.y, r * 0.55, 0, 6.283);
        g.fill();
      } else if (n.d.tipe === "profil" || n.d.tipe === "catatan") {
        g.fillStyle = warna;
        g.beginPath();
        g.arc(n.x, n.y, r, 0, 6.283);
        g.fill();
        g.fillStyle = "rgba(255,255,255,0.9)";
        g.beginPath();
        g.arc(n.x - r * 0.2, n.y - r * 0.2, r * 0.42, 0, 6.283);
        g.fill();
        if (m === "saraf") {
          g.strokeStyle = `${warna}99`;
          g.lineWidth = 1 / pv.k;
          g.beginPath();
          g.arc(n.x, n.y, r + 3.5, 0, 6.283);
          g.stroke();
        }
      } else {
        g.fillStyle = warna;
        g.beginPath();
        g.arc(n.x, n.y, r, 0, 6.283);
        g.fill();
      }
      // dicatat sendiri oleh AI: cincin putus-putus yang berputar pelan
      if (n.ai && (n.d.tipe === "profil" || n.d.tipe === "catatan")) {
        g.strokeStyle = WARNA_AI;
        g.globalAlpha = dim * 0.9;
        g.lineWidth = 1.2 / Math.max(0.8, pv.k * 0.8);
        g.setLineDash([2.5 / pv.k, 3.5 / pv.k]);
        g.lineDashOffset = gerak ? -t * 4 : 0;
        g.beginPath();
        g.arc(n.x, n.y, r * (n.d.tipe === "profil" && m === "rasi" ? 2.1 : 1.0) + 5, 0, 6.283);
        g.stroke();
        g.setLineDash([]);
      }
      g.globalAlpha = 1;
      if (dipilih) {
        g.strokeStyle = "#ffffff";
        g.lineWidth = 1.6 / pv.k;
        g.beginPath();
        g.arc(n.x, n.y, r * (n.d.tipe === "profil" && m === "rasi" ? 2.4 : 1.0) + 9 + (gerak ? 2 * Math.sin(t * 3) : 0), 0, 6.283);
        g.stroke();
      }
      if (so?.has(n.id)) {
        const ph = gerak ? (t * 0.8 + n.fase) % 1 : 0.4;
        g.strokeStyle = `rgba(253,224,71,${0.9 - ph * 0.8})`;
        g.lineWidth = 2 / pv.k;
        g.beginPath();
        g.arc(n.x, n.y, r + 6 + ph * 26, 0, 6.283);
        g.stroke();
        g.strokeStyle = "rgba(253,224,71,0.95)";
        g.beginPath();
        g.arc(n.x, n.y, r + 5, 0, 6.283);
        g.stroke();
      }
    }

    // label (ukuran tetap di layar)
    g.font = `500 ${11 / pv.k}px Inter, ui-sans-serif, system-ui, sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "top";
    g.lineJoin = "round";
    for (const n of urut) {
      const penting = n.id === sel || n.id === hov || (so?.has(n.id) ?? false);
      const dekat = aktifId !== null && tetangga.has(n.id);
      const topik = n.d.tipe === "topik" && (n.d.bobot > (m === "saraf" ? 0.5 : 0.6) || pv.k >= 1.3 || dekat);
      const kata = n.d.tipe === "kata" && m === "saraf" && (pv.k >= 1.25 || dekat);
      const memori = (n.d.tipe === "profil" || n.d.tipe === "catatan") && pv.k >= (m === "saraf" ? 1.8 : 1.3);
      if (!penting && !topik && !kata && !memori) continue;
      const teks = n.d.tipe === "topik" || n.d.tipe === "kata" ? n.d.label : n.d.label.length > 28 && !penting ? `${n.d.label.slice(0, 27)}…` : n.d.label;
      const dim = redup(n.id);
      const y = n.y + n.r * (n.d.tipe === "profil" && m === "rasi" ? 2.6 : 1) + 6;
      g.globalAlpha = penting ? 1 : 0.8 * dim;
      g.strokeStyle = "rgba(6,10,22,0.85)";
      g.lineWidth = 3 / pv.k;
      g.strokeText(teks, n.x, y);
      g.fillStyle = n.d.tipe === "topik" ? "#ddd6fe" : n.d.tipe === "kata" ? "#99f6e4" : "#f1f5f9";
      g.fillText(teks, n.x, y);
    }
    g.globalAlpha = 1;
    g.restore();
  }, []);

  // ---------------------------------------------------------------- loop & ukuran

  useEffect(() => {
    const el = wadah.current;
    const c = kanvas.current;
    if (!el || !c) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    kurangiGerak.current = mq.matches;
    const onMq = () => {
      kurangiGerak.current = mq.matches;
      minta();
    };
    mq.addEventListener("change", onMq);

    // bintang latar (tetap, acak tetap)
    bintang.current = Array.from({ length: 110 }, (_, i) => ({ x: hash(`bx${i}`), y: hash(`by${i}`), r: 0.4 + hash(`br${i}`) * 1.1, f: 0.6 + hash(`bf${i}`) * 1.8, a: 0.25 + hash(`ba${i}`) * 0.55 }));

    const ukur = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const lama = ukuran.current;
      const awal = lama.w === 600 && lama.h === 420 && lama.dpr === 1;
      ukuran.current = { w, h, dpr };
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      if (awal || !daftar.current.length || otoPas.current) {
        const t = hitungPas();
        if (t) pandang.current = t;
      } else pandang.current = { ...pandang.current, x: pandang.current.x + (w - lama.w) / 2, y: pandang.current.y + (h - lama.h) / 2 };
      minta();
    };
    ukur();
    const ro = new ResizeObserver(ukur);
    ro.observe(el);
    const io = new IntersectionObserver(([e]) => {
      kelihatan.current = e.isIntersecting;
      if (e.isIntersecting) minta();
    });
    io.observe(el);

    let raf = 0;
    let terakhir = 0;
    const loop = (ms: number) => {
      raf = requestAnimationFrame(loop);
      if (!kelihatan.current || document.hidden) return;
      const gerak = !kurangiGerak.current;
      // ~40 fps cukup untuk latar yang halus dan hemat baterai
      if (gerak && ms - terakhir < 24) return;
      terakhir = ms;
      if (otoPas.current && !fokus.current) {
        const t = hitungPas();
        if (t) {
          const p = pandang.current;
          const l = gerak ? 0.09 : 1;
          const sebelum = Math.abs(t.x - p.x) + Math.abs(t.y - p.y) + Math.abs(t.k - p.k) * 100;
          p.x += (t.x - p.x) * l;
          p.y += (t.y - p.y) * l;
          p.k += (t.k - p.k) * l;
          if (sebelum > 0.4) kotor.current = true;
        }
      }
      const f = fokus.current;
      if (f) {
        const p = pandang.current;
        const tx = ukuran.current.w / 2 - f.x * f.k;
        const ty = ukuran.current.h / 2 - f.y * f.k;
        p.x += (tx - p.x) * 0.14;
        p.y += (ty - p.y) * 0.14;
        p.k += (f.k - p.k) * 0.14;
        if (Math.abs(tx - p.x) + Math.abs(ty - p.y) + Math.abs(f.k - p.k) * 100 < 0.6) fokus.current = null;
        kotor.current = true;
      }
      if (alpha.current > 0.0301 || (gerak && alpha.current > 0)) {
        langkah();
        kotor.current = true;
      }
      if (gerak || kotor.current) {
        gambar(ms / 1000);
        kotor.current = false;
      }
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      mq.removeEventListener("change", onMq);
    };
  }, [gambar, hitungPas, langkah, minta, pas]);

  useEffect(() => {
    if (!penuh) return;
    const tutup = (e: KeyboardEvent) => e.key === "Escape" && setPenuh(false);
    const lama = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", tutup);
    return () => {
      document.body.style.overflow = lama;
      window.removeEventListener("keydown", tutup);
    };
  }, [penuh]);

  // ---------------------------------------------------------------- interaksi

  const dunia = useCallback((sx: number, sy: number) => ({ x: (sx - pandang.current.x) / pandang.current.k, y: (sy - pandang.current.y) / pandang.current.k }), []);

  const cari = useCallback(
    (sx: number, sy: number): Sim | null => {
      const p = dunia(sx, sy);
      const toleransi = 12 / pandang.current.k;
      let terbaik: Sim | null = null;
      let jarakTerbaik = Infinity;
      for (const n of daftar.current) {
        if (!tampil(n.d.tipe, modeRef.current)) continue;
        const luas = n.d.tipe === "profil" && modeRef.current === "rasi" ? n.r * 2.2 : n.r;
        const d = Math.hypot(n.x - p.x, n.y - p.y) - luas;
        if (d < toleransi && d < jarakTerbaik) {
          terbaik = n;
          jarakTerbaik = d;
        }
      }
      return terbaik;
    },
    [dunia],
  );

  const zoom = useCallback(
    (faktor: number, sx: number, sy: number) => {
      const pv = pandang.current;
      const k = Math.min(4, Math.max(0.2, pv.k * faktor));
      const f = k / pv.k;
      pandang.current = { k, x: sx - (sx - pv.x) * f, y: sy - (sy - pv.y) * f };
      fokus.current = null;
      otoPas.current = false;
      minta();
    },
    [minta],
  );

  useEffect(() => {
    const c = kanvas.current;
    if (!c) return;
    const aktif = new Map<number, { x: number; y: number }>();
    let seret: { tipe: "kanvas" | "node"; n?: Sim; mulaiX: number; mulaiY: number; gerak: boolean } | null = null;
    let jarakAwal = 0;
    let kAwal = 1;

    const lokal = (e: PointerEvent | WheelEvent) => {
      const b = c.getBoundingClientRect();
      return { x: e.clientX - b.left, y: e.clientY - b.top };
    };
    const turun = (e: PointerEvent) => {
      const p = lokal(e);
      aktif.set(e.pointerId, p);
      c.setPointerCapture(e.pointerId);
      if (aktif.size === 2) {
        const [a, b] = [...aktif.values()];
        jarakAwal = Math.hypot(a.x - b.x, a.y - b.y);
        kAwal = pandang.current.k;
        if (seret?.n) seret.n.tarik = false;
        seret = null;
        return;
      }
      const n = cari(p.x, p.y);
      seret = { tipe: n ? "node" : "kanvas", n: n ?? undefined, mulaiX: p.x, mulaiY: p.y, gerak: false };
      fokus.current = null;
    };
    const gerakPointer = (e: PointerEvent) => {
      const p = lokal(e);
      const lama = aktif.get(e.pointerId);
      if (aktif.size === 2 && lama) {
        const lain = [...aktif.entries()].find(([id]) => id !== e.pointerId)![1];
        aktif.set(e.pointerId, p);
        const jarak = Math.hypot(p.x - lain.x, p.y - lain.y);
        const tengah = { x: (p.x + lain.x) / 2, y: (p.y + lain.y) / 2 };
        const pv = pandang.current;
        if (jarakAwal > 0) zoom((kAwal * (jarak / jarakAwal)) / pv.k, tengah.x, tengah.y);
        pandang.current = { ...pandang.current, x: pandang.current.x + (p.x - lama.x) / 2, y: pandang.current.y + (p.y - lama.y) / 2 };
        minta();
        return;
      }
      if (aktif.has(e.pointerId)) aktif.set(e.pointerId, p);
      if (seret && aktif.has(e.pointerId)) {
        const dx = p.x - seret.mulaiX;
        const dy = p.y - seret.mulaiY;
        if (!seret.gerak && Math.hypot(dx, dy) > 4) seret.gerak = true;
        if (seret.gerak) {
          if (seret.tipe === "node" && seret.n) {
            const w = dunia(p.x, p.y);
            seret.n.tarik = true;
            seret.n.x = w.x;
            seret.n.y = w.y;
            alpha.current = Math.max(alpha.current, 0.25);
          } else {
            otoPas.current = false;
            pandang.current = { ...pandang.current, x: pandang.current.x + (p.x - (lama?.x ?? p.x)), y: pandang.current.y + (p.y - (lama?.y ?? p.y)) };
          }
          minta();
        }
        return;
      }
      if (e.pointerType === "mouse") {
        const n = cari(p.x, p.y);
        const id = n?.id ?? null;
        if (id !== hoverRef.current) {
          hoverRef.current = id;
          setHover(n ? { id: n.id, x: p.x, y: p.y } : null);
          c.style.cursor = n ? "pointer" : "grab";
          minta();
        }
      }
    };
    const angkat = (e: PointerEvent) => {
      const p = lokal(e);
      const s = seret;
      aktif.delete(e.pointerId);
      if (s?.n) s.n.tarik = false;
      if (s && !s.gerak && aktif.size === 0) {
        const n = cari(p.x, p.y);
        onPilih(n ? (n.id === terpilihRef.current ? null : n.id) : null);
        if (n && e.pointerType !== "mouse") setHover({ id: n.id, x: p.x, y: p.y });
        else if (!n) setHover(null);
      }
      if (aktif.size === 0) seret = null;
    };
    const batal = (e: PointerEvent) => {
      aktif.delete(e.pointerId);
      if (seret?.n) seret.n.tarik = false;
      seret = null;
    };
    const roda = (e: WheelEvent) => {
      e.preventDefault();
      const p = lokal(e);
      zoom(Math.exp(-e.deltaY * 0.0016), p.x, p.y);
    };
    const keluar = () => {
      if (hoverRef.current) {
        hoverRef.current = null;
        setHover(null);
        minta();
      }
    };
    const dblklik = () => pas();

    c.addEventListener("pointerdown", turun);
    c.addEventListener("pointermove", gerakPointer);
    c.addEventListener("pointerup", angkat);
    c.addEventListener("pointercancel", batal);
    c.addEventListener("pointerleave", keluar);
    c.addEventListener("wheel", roda, { passive: false });
    c.addEventListener("dblclick", dblklik);
    return () => {
      c.removeEventListener("pointerdown", turun);
      c.removeEventListener("pointermove", gerakPointer);
      c.removeEventListener("pointerup", angkat);
      c.removeEventListener("pointercancel", batal);
      c.removeEventListener("pointerleave", keluar);
      c.removeEventListener("wheel", roda);
      c.removeEventListener("dblclick", dblklik);
    };
  }, [cari, dunia, minta, onPilih, pas, zoom]);

  const kosong = !node.some((n) => n.tipe === "profil" || n.tipe === "catatan");
  const jumlahMemori = node.filter((n) => n.tipe === "profil" || n.tipe === "catatan").length;
  const jumlahTopik = node.filter((n) => n.tipe === "topik").length;
  const dipegang = hover ? simRef.current.get(hover.id)?.d : null;
  const ukur = ukuran.current;

  const tombol = "flex size-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.07] text-slate-200 backdrop-blur transition hover:bg-white/15 active:scale-95 sm:size-8";

  return (
    <div
      ref={wadah}
      className={`relative select-none overflow-hidden border border-slate-800 bg-[#060a16] shadow-[0_0_0_1px_rgba(255,255,255,0.03),0_20px_60px_-20px_rgba(76,29,149,0.45)] ${
        penuh ? "fixed inset-0 z-[70] rounded-none" : "h-[400px] rounded-2xl sm:h-[540px]"
      }`}
    >
      <canvas ref={kanvas} className="absolute inset-0 size-full cursor-grab" style={{ touchAction: "pan-y" }} role="img" aria-label={`Peta memori: ${jumlahMemori} memori, ${jumlahTopik} topik obrolan. Daftar lengkap ada di bagian Semua memori.`} />

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-2.5 sm:p-3">
        <div role="group" aria-label="Tampilan peta" className="pointer-events-auto flex rounded-xl border border-white/10 bg-white/[0.07] p-0.5 backdrop-blur">
          {([
            ["rasi", "Rasi bintang"],
            ["saraf", "Jaring saraf"],
          ] as const).map(([k, l]) => (
            <button key={k} type="button" aria-pressed={mode === k} onClick={() => onMode(k)} className={`min-h-9 whitespace-nowrap rounded-[10px] px-3 text-[12.5px] font-semibold transition sm:min-h-8 ${mode === k ? "bg-white text-slate-900 shadow" : "text-slate-300 hover:text-white"}`}>
              {l}
            </button>
          ))}
        </div>
        <div className="pointer-events-auto flex gap-1.5">
          <button type="button" className={`${tombol} hidden sm:flex`} onClick={() => zoom(1.3, ukur.w / 2, ukur.h / 2)} aria-label="Perbesar">
            <Icon name="plus" size={16} />
          </button>
          <button type="button" className={`${tombol} hidden sm:flex`} onClick={() => zoom(1 / 1.3, ukur.w / 2, ukur.h / 2)} aria-label="Perkecil">
            <Icon name="minus" size={16} />
          </button>
          <button type="button" className={tombol} onClick={() => pas()} aria-label="Pusatkan peta">
            <Icon name="compass" size={16} />
          </button>
          <button type="button" className={tombol} onClick={() => setPenuh((v) => !v)} aria-label={penuh ? "Keluar layar penuh" : "Layar penuh"} aria-pressed={penuh}>
            <Icon name={penuh ? "x" : "maximize"} size={16} />
          </button>
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-2.5 left-2.5 flex max-w-[68%] flex-wrap gap-x-3 gap-y-1 rounded-lg bg-[#060a16]/70 px-2.5 py-1.5 text-[11px] text-slate-300 backdrop-blur sm:bottom-3 sm:left-3">
        <Legenda warna={WARNA_NODE.profil} bentuk="bintang" label="Profil" />
        <Legenda warna={WARNA_NODE.catatan} label="Catatan" />
        <Legenda warna={WARNA_NODE.topik} kecil label="Topik obrolan" />
        {mode === "saraf" && <Legenda warna={WARNA_NODE.kata} kecil label="Kata penghubung" />}
        <Legenda warna={WARNA_AI} bentuk="cincin" label="Dicatat AI" />
      </div>
      <p className="pointer-events-none absolute bottom-2.5 right-3 text-right text-[11px] text-slate-400 sm:bottom-3">
        <span className="num text-slate-200">{jumlahMemori}</span> memori · <span className="num text-slate-200">{jumlahTopik}</span> topik
      </p>

      {kosong && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 px-8 text-center">
          <p className="text-sm font-semibold text-slate-100">Langitnya masih kosong</p>
          <p className="max-w-xs text-xs text-slate-400">Ceritakan sesuatu ke asisten atau tambahkan memori di bawah. Setiap hal yang diingat jadi satu bintang di sini.</p>
        </div>
      )}

      {dipegang && hover && (
        <div
          className="pointer-events-none absolute z-10 max-w-[240px] rounded-xl border border-white/15 bg-slate-900/92 px-3 py-2 text-xs text-slate-100 shadow-xl backdrop-blur"
          style={{ left: Math.min(Math.max(8, hover.x + 14), Math.max(8, ukur.w - 250)), top: Math.min(Math.max(8, hover.y + 14), Math.max(8, ukur.h - 90)) }}
        >
          <p className="mb-0.5 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide" style={{ color: WARNA_NODE[dipegang.tipe] }}>
            {dipegang.tipe === "profil" ? "Profil" : dipegang.tipe === "catatan" ? "Catatan" : dipegang.tipe === "topik" ? "Topik obrolan" : "Kata penghubung"}
            {dipegang.sumber === "asisten" && <span className="rounded bg-fuchsia-400/20 px-1 text-fuchsia-200">dicatat AI</span>}
          </p>
          <p className="leading-snug">{dipegang.teks ?? dipegang.label}</p>
          {dipegang.jumlah !== undefined && <p className="mt-0.5 text-slate-400">{dipegang.tipe === "topik" ? `${dipegang.jumlah} pesan` : `${dipegang.jumlah} memori`}</p>}
        </div>
      )}
    </div>
  );
}

function Legenda({ warna, label, bentuk = "titik", kecil }: { warna: string; label: string; bentuk?: "titik" | "bintang" | "cincin"; kecil?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {bentuk === "bintang" ? (
        <svg width="11" height="11" viewBox="-6 -6 12 12" aria-hidden="true">
          <path d="M0-6Q1.2-1.2 6 0Q1.2 1.2 0 6Q-1.2 1.2-6 0Q-1.2-1.2 0-6Z" fill={warna} />
        </svg>
      ) : bentuk === "cincin" ? (
        <span className="size-2.5 rounded-full border border-dashed" style={{ borderColor: warna }} />
      ) : (
        <span className={`rounded-full ${kecil ? "size-1.5" : "size-2.5"}`} style={{ background: warna, boxShadow: `0 0 6px ${warna}` }} />
      )}
      {label}
    </span>
  );
}
