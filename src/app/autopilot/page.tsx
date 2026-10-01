import LineChart from "@/components/charts/LineChart";
import Simulator from "@/components/Simulator";
import { Icon } from "@/components/icons";
import { Alert, Badge, Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import { prisma } from "@/lib/db";
import { rp } from "@/lib/money";
import { deteksiPola, proyeksi, saranMingguan } from "@/lib/services/autopilot";
import { statistikKiriman } from "@/lib/services/extra";
import { getCurrentPeriod } from "@/lib/services/periods";
import { fmtTanggal, fmtTanggalPanjang } from "@/lib/time";
import { jalankanSaranAction } from "../actions-plus";

export const metadata = { title: "Autopilot" };

export default async function AutopilotPage() {
  const now = new Date();
  if (!(await getCurrentPeriod(prisma))) {
    return (
      <div className="space-y-5">
        <PageHeader title="Autopilot" />
        <EmptyState icon="compass" title="Butuh periode aktif" href="/" cta="Ke Beranda">
          Proyeksi dan saran muncul setelah uang mingguan pertama dicatat.
        </EmptyState>
      </div>
    );
  }
  const [p, saran, pola, goal, kiriman] = await Promise.all([proyeksi(prisma, now), saranMingguan(prisma, now), deteksiPola(prisma, now), prisma.goal.findFirst(), statistikKiriman(prisma, now)]);
  const transfers = saran.filter((s) => s.transfer).map((s) => s.transfer!);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Autopilot"
        subtitle={`Proyeksi ${p.minggu.length} minggu dari rencana pembagian, tagihan, dan pola belanja nyata (${p.rata.sampel ? `rata-rata ${p.rata.sampel} minggu terakhir` : "perkiraan awal"}).`}
        actions={<Badge tone={p.risiko.length ? "warn" : "ok"} icon={p.risiko.length ? "alert" : "check"}>{p.risiko.length ? `${p.risiko.length} risiko` : "Aman"}</Badge>}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon="gift" label="Kado saat tenggat" value={p.kadoSaatTenggat === null ? "–" : rp(p.kadoSaatTenggat)} hint={goal ? `target min ${rp(goal.targetMin)}` : undefined} tone={goal && p.kadoSaatTenggat !== null && p.kadoSaatTenggat < goal.targetMin ? "bad" : undefined} />
        <Stat icon="umbrella" label="Darurat terendah" value={rp(p.daruratTerendah)} hint="selama proyeksi" tone={p.daruratTerendah < 20000 ? "warn" : undefined} />
        <Stat icon="utensils" label="Rata-rata makan" value={rp(p.rata.makan)} hint="per minggu" />
        <Stat icon="gift" label="Kiriman tambahan" value={rp(kiriman.rataPerMinggu)} hint="rata-rata/minggu (tidak masuk proyeksi)" />
      </div>

      {p.risiko.length > 0 && (
        <div className="space-y-2">
          {p.risiko.map((r) => (
            <Alert key={r} tone="warn">
              {r}
            </Alert>
          ))}
        </div>
      )}

      <Card title="Saran" icon="sparkles" action={transfers.length ? (
        <form action={jalankanSaranAction}>
          <input type="hidden" name="transfers" value={JSON.stringify(transfers)} />
          <button className="btn btn-sm">
            <Icon name="check" size={16} />
            Jalankan {transfers.length} pemindahan
          </button>
        </form>
      ) : undefined}>
        {saran.length === 0 ? (
          <p className="text-sm text-muted">Tidak ada saran. Semua di jalur yang benar.</p>
        ) : (
          <ul className="space-y-3">
            {saran.map((s) => (
              <li key={s.judul} className="flex gap-3">
                <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${s.tingkat === "penting" ? "bg-warn-bg text-warn" : "bg-subtle text-fg-2"}`}>
                  <Icon name={s.transfer ? "transfer" : "info"} size={17} />
                </span>
                <div>
                  <p className="text-sm font-semibold">{s.judul}</p>
                  <p className="text-sm text-muted">{s.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
        {transfers.length > 0 && <p className="mt-3 text-xs text-muted">Semua pemindahan dicatat sebagai satu aktivitas dan bisa dibatalkan di halaman Aktivitas.</p>}
      </Card>

      <Card title="Proyeksi saldo tabungan" icon="trending-up">
        <LineChart
          title="Proyeksi saldo Tabungan kado, Darurat, dan Paylater"
          labels={p.minggu.map((m) => fmtTanggal(m.mulai))}
          series={[
            { key: "kado", label: "Tabungan kado", color: "var(--series-4)", values: p.minggu.map((m) => m.kado) },
            { key: "darurat", label: "Darurat", color: "var(--series-5)", values: p.minggu.map((m) => m.darurat) },
            { key: "paylater", label: "Paylater", color: "var(--series-3)", values: p.minggu.map((m) => m.paylater) },
          ]}
          refs={goal ? [{ value: goal.targetMin, label: "Target kado" }] : []}
        />
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-medium text-brand">Lihat sebagai tabel</summary>
          <div className="-mx-4 mt-2 overflow-x-auto sm:mx-0">
            <table className="table min-w-[560px]">
              <thead>
                <tr>
                  <th>Minggu</th>
                  <th className="!text-right">Masuk</th>
                  <th className="!text-right">Kado</th>
                  <th className="!text-right">Darurat</th>
                  <th className="!text-right">Paylater</th>
                  <th>Tagihan</th>
                </tr>
              </thead>
              <tbody>
                {p.minggu.map((m) => (
                  <tr key={m.mulai}>
                    <td className="whitespace-nowrap">{fmtTanggalPanjang(m.mulai)}</td>
                    <td className="num text-right">{rp(m.pemasukan)}</td>
                    <td className="num text-right">{rp(m.kado)}</td>
                    <td className={`num text-right ${m.darurat < 0 ? "text-bad" : ""}`}>{rp(m.darurat)}</td>
                    <td className="num text-right">{rp(m.paylater)}</td>
                    <td className="text-xs">
                      {m.tagihan.map((t) => (
                        <span key={t.jatuhTempo} className={t.kurang ? "text-bad" : ""}>
                          {rp(t.nominal)} {fmtTanggal(t.jatuhTempo)}
                          {t.kurang ? ` (kurang ${rp(t.kurang)})` : ""}{" "}
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card title="Simulasi “kalau…”" icon="compass">
          <Simulator />
        </Card>
        <Card title="Pola & kebiasaan" icon="pulse">
          {pola.length === 0 ? (
            <p className="text-sm text-muted">Datanya belum cukup. Catat terus 1–2 minggu lagi.</p>
          ) : (
            <ul className="space-y-3">
              {pola.map((x) => (
                <li key={x.judul}>
                  <p className="text-sm font-semibold">{x.judul}</p>
                  <p className="text-sm text-muted">{x.detail}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
