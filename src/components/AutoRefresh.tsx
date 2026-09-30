"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Menyegarkan data server tiap beberapa detik supaya catatan dari WhatsApp muncul tanpa refresh manual. */
export default function AutoRefresh({ detik = 4 }: { detik?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, detik * 1000);
    return () => clearInterval(id);
  }, [router, detik]);
  return null;
}
