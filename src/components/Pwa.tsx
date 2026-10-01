"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";

const AMBANG = 72;

/**
 * Perilaku "aplikasi beneran" untuk PWA (khususnya iPhone):
 * - daftarkan service worker (buka cepat + halaman offline)
 * - tarik ke bawah untuk muat ulang (mode aplikasi iOS tidak punya tombol reload)
 * - petunjuk "Tambah ke Layar Utama" untuk Safari iPhone yang belum dipasang
 */
export default function Pwa() {
  const router = useRouter();
  const [tarik, setTarik] = useState(0);
  const [muat, setMuat] = useState(false);
  const [petunjuk, setPetunjuk] = useState(false);
  const awal = useRef<number | null>(null);

  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    document.documentElement.classList.toggle("pwa", standalone);
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    try {
      if (ios && !standalone && !localStorage.getItem("dk-petunjuk-pasang")) setPetunjuk(true);
    } catch {
      /* penyimpanan diblokir */
    }
  }, []);

  useEffect(() => {
    const mulai = (e: TouchEvent) => {
      awal.current = window.scrollY <= 0 && !muat ? e.touches[0].clientY : null;
    };
    const gerak = (e: TouchEvent) => {
      if (awal.current === null) return;
      const d = e.touches[0].clientY - awal.current;
      if (d <= 0 || window.scrollY > 0) return setTarik(0);
      setTarik(Math.min(120, d * 0.5));
    };
    const lepas = () => {
      if (awal.current === null) return;
      awal.current = null;
      setTarik((t) => {
        if (t >= AMBANG) {
          setMuat(true);
          router.refresh();
          setTimeout(() => setMuat(false), 900);
        }
        return 0;
      });
    };
    window.addEventListener("touchstart", mulai, { passive: true });
    window.addEventListener("touchmove", gerak, { passive: true });
    window.addEventListener("touchend", lepas);
    return () => {
      window.removeEventListener("touchstart", mulai);
      window.removeEventListener("touchmove", gerak);
      window.removeEventListener("touchend", lepas);
    };
  }, [router, muat]);

  const tutupPetunjuk = () => {
    setPetunjuk(false);
    try {
      localStorage.setItem("dk-petunjuk-pasang", "1");
    } catch {
      /* abaikan */
    }
  };

  return (
    <>
      {(tarik > 0 || muat) && (
        <div className="pointer-events-none fixed inset-x-0 z-40 flex justify-center" style={{ top: `calc(env(safe-area-inset-top) + ${muat ? 12 : tarik / 2}px)` }} aria-hidden="true">
          <span className="flex size-9 items-center justify-center rounded-full border border-line bg-card text-brand shadow-md">
            <Icon name="refresh" size={18} className={muat ? "animate-spin" : ""} style={{ transform: muat ? undefined : `rotate(${tarik * 3}deg)`, opacity: Math.min(1, tarik / AMBANG + (muat ? 1 : 0)) }} />
          </span>
        </div>
      )}
      {petunjuk && (
        <div role="dialog" aria-label="Pasang DompetKos" className="fixed inset-x-3 z-50 rounded-2xl border border-line bg-card p-4 shadow-xl lg:hidden" style={{ bottom: "calc(env(safe-area-inset-bottom) + 84px)" }}>
          <div className="flex items-start gap-3">
            <Icon name="download" size={20} className="mt-0.5 shrink-0 text-brand" />
            <p className="min-w-0 flex-1 text-sm">
              <b>Pasang jadi aplikasi:</b> tekan tombol <b>Bagikan</b> di Safari, lalu <b>Tambah ke Layar Utama</b>.
            </p>
            <button type="button" onClick={tutupPetunjuk} className="-m-1 flex size-8 shrink-0 items-center justify-center rounded-full text-muted" aria-label="Tutup">
              <Icon name="x" size={16} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
