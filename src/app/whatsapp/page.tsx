import WaPanel from "@/components/WaPanel";
import { Alert, PageHeader } from "@/components/ui";

export const metadata = { title: "Koneksi WhatsApp" };

export default function WhatsAppPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader title="Koneksi WhatsApp" subtitle="Bot berjalan sebagai perangkat tertaut di nomor cadangan." />
      <Alert tone="warn">Library WhatsApp tidak resmi: nomor bot bisa diblokir kapan saja. Jangan pakai nomor utama atau nomor penerima.</Alert>
      <WaPanel />
    </div>
  );
}
