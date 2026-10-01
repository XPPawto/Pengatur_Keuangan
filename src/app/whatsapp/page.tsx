import { redirect } from "next/navigation";

/** Halaman lama: koneksi WhatsApp sekarang digabung dengan Claude di halaman Koneksi. */
export default function WhatsAppPage() {
  redirect("/koneksi#whatsapp");
}
