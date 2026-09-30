import Link from "next/link";
import { prisma } from "@/lib/db";
import { Icon } from "./icons";

/** Banner merah di semua halaman kalau WhatsApp terputus atau proses bot tidak jalan. */
export default async function WaBanner() {
  const c = await prisma.waConnection.findUnique({ where: { id: 1 } }).catch(() => null);
  if (!c) return null;
  const botMati = !c.workerPing || Date.now() - c.workerPing.getTime() > 30_000;
  if (c.status === "terhubung" && !botMati) return null;

  const pesan = botMati
    ? "Proses bot tidak berjalan. Pesan WhatsApp dan pengingat tertunda."
    : c.status === "menunggu_pairing"
      ? "WhatsApp menunggu dipasangkan."
      : "WhatsApp terputus. Bot belum bisa menerima atau mengirim pesan.";
  return (
    <div role="alert" className="sticky top-0 z-20 flex items-center justify-center gap-2 bg-[#b42318] px-4 py-2 text-center text-[13px] font-medium text-white">
      <Icon name="link-off" size={16} className="shrink-0" />
      <span>{pesan}</span>
      <Link href="/whatsapp" className="shrink-0 font-semibold underline underline-offset-2">
        Buka koneksi
      </Link>
    </div>
  );
}
