import Link from "next/link";
import ActionForm from "@/components/ActionForm";
import { Icon, type IconName } from "@/components/icons";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { prisma } from "@/lib/db";
import { listActivities } from "@/lib/services/undo";
import { fmtTanggalPanjang, namaHari, wibDate, wibHM } from "@/lib/time";
import { undoAksi } from "../actions-plus";

export const metadata = { title: "Aktivitas" };

const PER_HAL = 40;
const IKON: Record<string, IconName> = {
  catat: "receipt",
  hapus_transaksi: "trash",
  ubah_transaksi: "pencil",
  pindah: "transfer",
  hapus_pindah: "trash",
  bayar_tagihan: "calendar",
  batal_lunas: "calendar",
  uang_masuk: "wallet",
  uang_ekstra: "wallet",
  kiriman: "gift",
  koreksi_pemasukan: "pencil",
  rekonsiliasi: "scale",
  tanpa_jajan: "check-circle",
  tahan_belanja: "pause",
  hutang: "hand-coins",
  bayar_hutang: "hand-coins",
  patungan: "users",
  saran: "compass",
  batal: "undo",
};

export default async function AktivitasPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const hal = Math.max(1, Number(sp.hal) || 1);
  const [rows, total, nomor] = await Promise.all([
    listActivities(prisma, { take: PER_HAL, skip: (hal - 1) * PER_HAL }),
    prisma.activityLog.count(),
    prisma.allowedNumber.findMany(),
  ]);
  const label = (oleh: string) => (oleh === "web" ? "Website" : oleh === "sistem" ? "Sistem" : (nomor.find((n) => n.nomor === oleh)?.label ?? `+${oleh}`));
  const perHari = new Map<string, typeof rows>();
  for (const r of rows) {
    const t = wibDate(r.waktu);
    perHari.set(t, [...(perHari.get(t) ?? []), r]);
  }
  const halaman = Math.ceil(total / PER_HAL);

  return (
    <div className="space-y-4">
      <PageHeader title="Aktivitas" subtitle="Jejak semua perubahan data: siapa, kapan, dari mana. Aksi yang salah bisa dibatalkan di sini atau dengan `batal` di WhatsApp." />
      {rows.length === 0 && <EmptyState icon="undo" title="Belum ada aktivitas" />}
      {[...perHari.entries()].map(([tgl, list]) => (
        <Card key={tgl} className="!py-2">
          <h2 className="border-b border-line py-2 text-[13px] font-semibold text-muted">
            {namaHari(tgl)}, {fmtTanggalPanjang(tgl)}
          </h2>
          <ul className="divide-y divide-line">
            {list.map((r) => {
              const { jam, menit } = wibHM(r.waktu);
              return (
                <li key={r.id} className="flex items-start gap-3 py-3">
                  <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${r.dibatalkanPada ? "bg-subtle text-muted" : "bg-brand-soft text-brand"}`}>
                    <Icon name={IKON[r.aksi] ?? "info"} size={17} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-medium ${r.dibatalkanPada ? "text-muted line-through" : ""}`}>{r.ringkasan}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                      <span className="num">
                        {String(jam).padStart(2, "0")}.{String(menit).padStart(2, "0")}
                      </span>
                      · {label(r.oleh)}
                      <Badge tone={r.sumber === "wa" ? "ok" : r.sumber === "web" ? "neutral" : "brand"}>{r.sumber === "wa" ? "WA" : r.sumber === "web" ? "Web" : "Sistem"}</Badge>
                      {r.dibatalkanPada && <Badge tone="warn">Dibatalkan oleh {label(r.dibatalkanOleh ?? "")}</Badge>}
                    </p>
                  </div>
                  {r.undo && !r.dibatalkanPada && (
                    <ActionForm action={undoAksi} submit={<><Icon name="undo" size={15} />Batalkan</>} submitClass="btn-secondary btn-sm" className="flex shrink-0 flex-col items-end gap-1">
                      <input type="hidden" name="id" value={r.id} />
                    </ActionForm>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      ))}
      {halaman > 1 && (
        <nav className="flex items-center justify-between text-sm" aria-label="Halaman">
          {hal > 1 ? <Link href={`/aktivitas?hal=${hal - 1}`} className="btn-secondary btn-sm">Lebih baru</Link> : <span />}
          <span className="text-muted">
            Halaman {hal} dari {halaman}
          </span>
          {hal < halaman ? <Link href={`/aktivitas?hal=${hal + 1}`} className="btn-secondary btn-sm">Lebih lama</Link> : <span />}
        </nav>
      )}
    </div>
  );
}
