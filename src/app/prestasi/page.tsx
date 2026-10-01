import StackedColumns from "@/components/charts/StackedColumns";
import ProgressBar from "@/components/ProgressBar";
import { Icon } from "@/components/icons";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { prisma } from "@/lib/db";
import { getPrestasi } from "@/lib/services/game";
import { fmtTanggal } from "@/lib/time";

export const metadata = { title: "Prestasi" };

const KOMPONEN = [
  { k: "disiplin", label: "Disiplin mencatat", maks: 40 },
  { k: "makan", label: "Makan dalam jatah", maks: 30 },
  { k: "tanpaJajan", label: "Hari tanpa jajan", maks: 10 },
  { k: "tahan", label: "Tahan belanja", maks: 10 },
  { k: "tagihan", label: "Tagihan tepat waktu", maks: 10 },
] as const;

export default async function PrestasiPage() {
  const p = await getPrestasi(prisma, new Date());
  const persenLevel = ((p.level.xp - p.level.xpLevelIni) / Math.max(1, p.level.xpBerikut - p.level.xpLevelIni)) * 100;
  const didapat = p.lencana.filter((l) => l.didapat).length;

  return (
    <div className="space-y-5">
      <PageHeader title="Prestasi" subtitle="Skor mingguan, tantangan, dan lencana dihitung otomatis dari catatan lo." />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="card card-pad lg:col-span-1">
          <p className="flex items-center gap-2 text-sm font-medium text-muted">
            <Icon name="trophy" size={17} />
            Level
          </p>
          <p className="mt-2 text-4xl font-extrabold tracking-tight">{p.level.level}</p>
          <p className="font-semibold text-brand">{p.level.gelar}</p>
          <div className="mt-4">
            <ProgressBar persen={persenLevel} tone="brand" tebal label="Progres level" />
          </div>
          <p className="mt-1.5 text-xs text-muted">
            {p.level.xp} XP · {p.level.xpBerikut - p.level.xp} XP lagi ke level {p.level.level + 1}
          </p>
          <p className="mt-3 flex items-center gap-1.5 text-sm">
            <Icon name="flame" size={16} className="text-warn" /> Streak <b>{p.streak} hari</b>
          </p>
        </section>

        <section className="card card-pad lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold">
              <Icon name="star" size={18} className="text-muted" />
              Skor minggu ini
            </h2>
            <span className="num text-3xl font-extrabold">
              {p.skorIni?.total ?? 0}
              <span className="text-base font-medium text-muted">/100</span>
            </span>
          </div>
          {p.skorIni ? (
            <ul className="mt-3 space-y-2.5">
              {KOMPONEN.map((c) => {
                const v = p.skorIni![c.k];
                return (
                  <li key={c.k}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span>{c.label}</span>
                      <span className="num font-medium">
                        {v}/{c.maks}
                      </span>
                    </div>
                    <ProgressBar persen={(v / c.maks) * 100} tone={v === c.maks ? "ok" : v >= c.maks / 2 ? "brand" : "warn"} label={c.label} />
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted">Skor muncul setelah periode pertama berjalan.</p>
          )}
        </section>
      </div>

      <Card title="Tantangan minggu ini" icon="target">
        {p.tantangan.length === 0 ? (
          <p className="text-sm text-muted">Belum ada periode aktif.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {p.tantangan.map((t) => (
              <li key={t.judul} className="rounded-xl border border-line p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold">{t.judul}</p>
                  <Badge tone={t.selesai ? "ok" : t.gagal ? "bad" : "neutral"} icon={t.selesai ? "check" : t.gagal ? "x" : "clock"}>
                    {t.selesai ? "Selesai" : t.gagal ? "Gagal" : "Berjalan"}
                  </Badge>
                </div>
                <div className="mt-2">
                  <ProgressBar persen={t.progres * 100} tone={t.gagal ? "bad" : t.selesai ? "ok" : "brand"} label={t.judul} />
                </div>
                <p className="mt-1 text-xs text-muted">{t.keterangan}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={`Lencana (${didapat}/${p.lencana.length})`} icon="trophy">
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {p.lencana.map((l) => (
            <li key={l.kode} className={`flex flex-col items-center rounded-xl border p-3 text-center ${l.didapat ? "border-brand/40 bg-brand-soft" : "border-line opacity-60"}`}>
              <span className={`flex size-11 items-center justify-center rounded-full ${l.didapat ? "bg-brand text-brand-fg" : "bg-subtle text-muted"}`}>
                <Icon name={l.didapat ? "trophy" : "lock"} size={20} />
              </span>
              <p className="mt-2 text-sm font-semibold">{l.nama}</p>
              <p className="text-[11px] leading-snug text-muted">{l.deskripsi}</p>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Riwayat skor" icon="chart">
        {p.riwayat.length === 0 ? (
          <EmptyState icon="chart" title="Belum ada riwayat" />
        ) : (
          <StackedColumns
            title="Skor mingguan"
            labels={p.riwayat.map((r) => fmtTanggal(r.mulai))}
            series={[{ key: "skor", label: "Skor", color: "var(--series-1)" }]}
            data={p.riwayat.map((r) => ({ skor: r.skor }))}
            refLine={{ value: 80, label: "Target 80" }}
          />
        )}
      </Card>
    </div>
  );
}
