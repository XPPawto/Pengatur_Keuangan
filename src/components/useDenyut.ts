"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Denyut } from "@/lib/services/koneksi";
import type { IconName } from "./icons";

/** Satu titik cahaya yang berjalan di satu garis peta, dari node `dari` ke node `ke`. */
export interface Jejak {
  id: number;
  dari: string;
  ke: string;
  warna: string;
  mulai: number;
  durasi: number;
}

export interface LogLive {
  id: string;
  waktu: Date;
  ikon: IconName;
  teks: string;
  nada: "ok" | "claude" | "bad" | "muted";
}

const LABEL: Record<string, string> = {
  chat_web: "Chat website",
  chat_wa: "Asisten WhatsApp",
  struk: "Baca foto",
  review: "Review Sabtu",
  kategori: "Tebak kategori",
  cek: "Cek koneksi",
};
const PERAN: Record<string, string> = { pemilik: "pemilik", keluarga: "keluarga" };
const HOP_MS = 650;
const JEDA_ANTAR_PESAN = 280;
const POLL_MS = 1500;

const WA = "var(--ok)";
const CLAUDE = "var(--claude)";
const MERAH = "var(--bad)";

/**
 * Memantau aktivitas langsung (pesan WhatsApp & panggilan Claude) lewat /api/koneksi/denyut dan
 * mengubahnya jadi titik-titik berjalan di peta + log singkat. Isi pesan tidak pernah diambil.
 */
export function useDenyut() {
  const [jejak, setJejak] = useState<Jejak[]>([]);
  const [berjalan, setBerjalan] = useState<Map<number, string>>(new Map());
  const [log, setLog] = useState<LogLive[]>([]);
  const [waktu, setWaktu] = useState(0);
  const kursor = useRef<{ pesan?: number; ai?: number }>({});
  const jalanRef = useRef(new Map<number, string>());
  const nomor = useRef(0);
  const antre = useRef(0);
  const hemat = useRef(false);

  useEffect(() => {
    hemat.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  /** Jadwalkan rangkaian hop berurutan (mis. pemilik→wa lalu wa→hub). */
  const kirim = useCallback((hops: [string, string][], warna: string) => {
    if (hemat.current) return;
    const kini = performance.now();
    // rangkaian berikutnya menunggu yang sebelumnya selesai (antrean dibatasi supaya tidak tertinggal jauh)
    const awal = Math.max(kini, Math.min(antre.current, kini + 4000));
    antre.current = awal + hops.length * HOP_MS + JEDA_ANTAR_PESAN;
    setJejak((j) => [...j, ...hops.map(([dari, ke], i) => ({ id: ++nomor.current, dari, ke, warna, mulai: awal + i * HOP_MS, durasi: HOP_MS }))]);
  }, []);

  const catat = useCallback((l: Omit<LogLive, "id">) => {
    setLog((x) => [{ ...l, id: `${l.waktu.getTime()}-${++nomor.current}` }, ...x].slice(0, 6));
  }, []);

  // detak animasi: jalan hanya selama ada titik (termasuk 500 ms "kilat" di node tujuan)
  useEffect(() => {
    if (!jejak.length) return;
    let id = 0;
    const loop = () => {
      const kini = performance.now();
      setWaktu(kini);
      setJejak((j) => (j.some((x) => kini > x.mulai + x.durasi + 600) ? j.filter((x) => kini <= x.mulai + x.durasi + 600) : j));
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [jejak.length]);

  useEffect(() => {
    let mati = false;
    let sibuk = false;
    const tarik = async () => {
      if (sibuk) return;
      sibuk = true;
      try {
        await tarikSekali();
      } finally {
        sibuk = false;
      }
    };
    const tarikSekali = async () => {
      const q = new URLSearchParams();
      if (kursor.current.pesan !== undefined) q.set("p", String(kursor.current.pesan));
      if (kursor.current.ai !== undefined) q.set("a", String(kursor.current.ai));
      if (jalanRef.current.size) q.set("cek", [...jalanRef.current.keys()].join(","));
      let d: Denyut;
      try {
        const r = await fetch(`/api/koneksi/denyut?${q}`, { cache: "no-store" });
        if (!r.ok) return;
        d = await r.json();
      } catch {
        return;
      }
      if (mati) return;
      const pertama = kursor.current.pesan === undefined;
      kursor.current = d.kursor;

      for (const p of d.pesan) {
        const peran = PERAN[p.peran] ?? "pemilik";
        if (p.arah === "masuk") {
          kirim([[p.peran, "wa"], ["wa", "hub"]], WA);
          catat({ waktu: new Date(p.waktu), ikon: "message", teks: `Pesan masuk dari ${peran}`, nada: "ok" });
        } else if (p.proaktif) {
          kirim([["antrean", "wa"], ["wa", p.peran]], WA);
          catat({ waktu: new Date(p.waktu), ikon: "send", teks: `Pesan terjadwal terkirim ke ${peran}`, nada: "ok" });
        } else {
          kirim([["hub", "wa"], ["wa", p.peran]], WA);
          catat({ waktu: new Date(p.waktu), ikon: "send", teks: `Bot membalas ${peran}`, nada: "ok" });
        }
      }

      const jalan = new Map(jalanRef.current);
      for (const c of d.ai) {
        const label = LABEL[c.fitur] ?? c.fitur;
        if (c.status === "berjalan") {
          jalan.set(c.id, c.fitur);
          if (!pertama) kirim([["hub", "claude"], ["claude", c.fitur]], CLAUDE);
          catat({ waktu: new Date(), ikon: "bot", teks: `Claude: ${label} · lagi mikir…`, nada: "claude" });
        } else {
          // sudah selesai sebelum sempat terlihat berjalan: tampilkan pergi-pulang sekaligus
          kirim([["hub", "claude"], ["claude", c.fitur], [c.fitur, "claude"], ["claude", "hub"]], c.status === "ok" ? CLAUDE : MERAH);
          catat({ waktu: new Date(), ikon: c.status === "ok" ? "check-circle" : "alert", teks: `Claude: ${label} · ${c.status === "ok" ? "berhasil" : "gagal"}`, nada: c.status === "ok" ? "claude" : "bad" });
        }
      }
      for (const c of d.cek) {
        if (c.status === "berjalan") continue;
        const fitur = jalan.get(c.id);
        jalan.delete(c.id);
        if (!fitur) continue;
        kirim([[fitur, "claude"], ["claude", "hub"]], c.status === "ok" ? CLAUDE : MERAH);
        catat({ waktu: new Date(), ikon: c.status === "ok" ? "check-circle" : "alert", teks: `Claude: ${LABEL[fitur] ?? fitur} · ${c.status === "ok" ? "selesai" : c.status === "terputus" ? "terputus" : "gagal"}`, nada: c.status === "ok" ? "claude" : "bad" });
      }
      // selama Claude masih mikir, titik terus mengalir ke Claude & fitur yang dipakai
      if (!pertama) for (const f of new Set(jalan.values())) if (!d.ai.some((c) => c.fitur === f)) kirim([["hub", "claude"], ["claude", f]], CLAUDE);
      jalanRef.current = jalan;
      setBerjalan(jalan);
    };
    void tarik();
    const id = setInterval(() => void tarik(), POLL_MS);
    return () => {
      mati = true;
      clearInterval(id);
    };
  }, [kirim, catat]);

  return { jejak, berjalan, log, waktu };
}
