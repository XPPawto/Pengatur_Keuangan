import Link from "next/link";
import AutoRefresh from "@/components/AutoRefresh";
import { Icon, type IconName } from "@/components/icons";
import { Badge, Card, PageHeader, Stat } from "@/components/ui";
import { prisma } from "@/lib/db";
import { cekKesehatan, type Status } from "@/lib/services/health";

export const metadata = { title: "Kesehatan sistem" };

const TONE: Record<Status, "ok" | "warn" | "bad"> = { ok: "ok", peringatan: "warn", masalah: "bad" };
const LABEL: Record<Status, string> = { ok: "Sehat", peringatan: "Perlu perhatian", masalah: "Bermasalah" };
const IKON: Record<string, IconName> = { bot: "pulse", wa: "message", antrean: "send", backup: "database", disk: "file" };
const LINK: Record<string, string> = { wa: "/whatsapp", antrean: "/pengaturan", backup: "/pengaturan" };

export default async function SistemPage() {
  const h = await cekKesehatan(prisma, new Date());
  return (
    <div className="space-y-5">
      <AutoRefresh detik={10} />
      <PageHeader
        title="Kesehatan sistem"
        subtitle="Diperbarui otomatis. Bot juga mengirim peringatan ke WhatsApp kalau backup terlambat, antrean macet, atau disk hampir penuh."
        actions={<Badge tone={TONE[h.status]} icon={h.status === "ok" ? "check" : "alert"}>{LABEL[h.status]}</Badge>}
      />
      <Card>
        <ul className="divide-y divide-line">
          {h.cek.map((c) => (
            <li key={c.kode} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-subtle">
                <Icon name={IKON[c.kode] ?? "info"} size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{c.nama}</p>
                <p className="text-xs text-muted">{c.detail}</p>
              </div>
              <Badge tone={TONE[c.status]}>{LABEL[c.status]}</Badge>
              {LINK[c.kode] && (
                <Link href={LINK[c.kode]} className="btn-ghost btn-sm !px-2" aria-label={`Buka ${c.nama}`}>
                  <Icon name="chevron-right" size={16} />
                </Link>
              )}
            </li>
          ))}
        </ul>
      </Card>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat icon="receipt" label="Transaksi" value={h.statistik.transaksi.toLocaleString("id-ID")} />
        <Stat icon="calendar" label="Periode" value={String(h.statistik.periode)} />
        <Stat icon="undo" label="Aktivitas tercatat" value={h.statistik.aktivitas.toLocaleString("id-ID")} />
        <Stat icon="database" label="Ukuran database" value={`${(h.statistik.ukuranDb / 1024).toFixed(0)} KB`} />
      </div>
      <p className="text-center text-xs text-muted">
        DompetKos {h.versi.app} · Node {h.versi.node} · endpoint cek: <code>/api/health</code>
      </p>
    </div>
  );
}
