import WaPanel from "@/components/WaPanel";

export default function WhatsAppPage() {
  return (
    <main className="space-y-4">
      <h1 className="text-xl font-bold">Koneksi WhatsApp</h1>
      <p className="text-sm text-muted">
        Bot jalan sebagai perangkat tertaut di nomor cadangan. Library tidak resmi, jadi jangan pakai nomor utama.
      </p>
      <WaPanel />
    </main>
  );
}
