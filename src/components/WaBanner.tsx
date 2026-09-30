import Link from "next/link";
import { prisma } from "@/lib/db";

/** Banner merah di semua halaman kalau WhatsApp terputus atau proses bot tidak jalan. */
export default async function WaBanner() {
  const c = await prisma.waConnection.findUnique({ where: { id: 1 } }).catch(() => null);
  if (!c) return null;
  const botMati = !c.workerPing || Date.now() - c.workerPing.getTime() > 30_000;
  if (c.status === "terhubung" && !botMati) return null;

  const pesan = botMati
    ? "Proses bot nggak jalan. Catat lewat WhatsApp belum bisa sampai data ini dijalankan lagi (npm run dev:bot)."
    : c.status === "menunggu_pairing"
      ? "WhatsApp lagi nunggu dipasangkan."
      : "WhatsApp terputus. Bot belum bisa terima atau kirim pesan.";
  return (
    <div role="alert" className="sticky top-0 z-30 bg-[#b91c1c] px-4 py-2 text-center text-sm font-medium text-white">
      {pesan}{" "}
      <Link href="/whatsapp" className="underline">
        Buka Koneksi
      </Link>
    </div>
  );
}
