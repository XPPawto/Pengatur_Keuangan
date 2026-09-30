import ActionForm from "@/components/ActionForm";
import LineChart from "@/components/charts/LineChart";
import ProgressBar from "@/components/ProgressBar";
import { Alert, Badge, Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import { prisma } from "@/lib/db";
import { rp } from "@/lib/money";
import { getGoalProgress } from "@/lib/services/goals";
import { fmtTanggal, fmtTanggalPanjang } from "@/lib/time";
import { simpanTarget } from "../actions-keuangan";

export const metadata = { title: "Target" };

const STATUS = {
  tercapai: { tone: "ok", label: "Target minimal tercapai" },
  ideal: { tone: "ok", label: "Menuju target ideal" },
  aman: { tone: "ok", label: "Sesuai jalur target minimal" },
  kurang: { tone: "bad", label: "Di bawah target minimal" },
} as const;

export default async function TargetPage() {
  const g = await getGoalProgress(prisma, new Date());
  if (!g) return <EmptyState icon="target" title="Belum ada target" />;
  const st = STATUS[g.status];

  return (
    <div className="space-y-5">
      <PageHeader title="Target" subtitle={g.goal.nama} actions={<Badge tone={st.tone} icon={st.tone === "ok" ? "check" : "alert"}>{st.label}</Badge>} />

      <Card>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-sm text-muted">Terkumpul</p>
            <p className="num text-[40px] font-extrabold leading-none tracking-tight">{rp(g.saldo)}</p>
          </div>
          <p className="text-sm text-muted">
            {g.hariLagi >= 0 ? `${g.hariLagi} hari lagi` : "Tenggat lewat"} · beli kado paling lambat {fmtTanggalPanjang(g.goal.tenggat)}
          </p>
        </div>
        <div className="mt-4">
          <ProgressBar persen={g.persenMin} tone="brand" tebal label="Progres menuju target minimal" />
          <div className="mt-1.5 flex justify-between text-xs text-muted">
            <span>{Math.round(g.persenMin)}% dari minimal</span>
            <span className="num">
              {rp(g.goal.targetMin)} – {rp(g.goal.targetIdeal)}
            </span>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon="trending-up" label="Proyeksi saat tenggat" value={rp(g.proyeksi)} hint={`${g.setoranTersisa} setoran lagi sesuai rencana`} />
        <Stat icon="target" label="Target minimal" value={rp(g.goal.targetMin)} hint={g.kurangDariMin ? `kurang ${rp(g.kurangDariMin)}` : "terjangkau"} tone={g.kurangDariMin ? "bad" : undefined} />
        <Stat icon="sparkles" label="Target ideal" value={rp(g.goal.targetIdeal)} hint={g.proyeksi >= g.goal.targetIdeal ? "terjangkau" : `selisih ${rp(g.goal.targetIdeal - g.proyeksi)}`} />
        <Stat icon="calendar" label="Perkiraan tembus minimal" value={g.estimasiTercapai ? fmtTanggal(g.estimasiTercapai) : "–"} hint={g.estimasiTercapai ? "minggu setoran" : "belum terjangkau"} />
      </div>

      <Card title="Tabungan kumulatif per minggu" icon="chart">
        {g.series.length === 0 ? (
          <p className="text-sm text-muted">Grafik muncul setelah ada rencana atau setoran.</p>
        ) : (
          <>
            <LineChart
              title="Tabungan kado kumulatif: aktual dibanding rencana"
              labels={g.series.map((p) => fmtTanggal(p.minggu))}
              series={[
                { key: "aktual", label: "Aktual", color: "var(--series-1)", values: g.series.map((p) => p.aktual) },
                { key: "rencana", label: "Rencana", color: "var(--series-2)", values: g.series.map((p) => p.rencana) },
              ]}
              refs={[
                { value: g.goal.targetMin, label: "Minimal" },
                { value: g.goal.targetIdeal, label: "Ideal" },
              ]}
            />
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-medium text-brand">Lihat sebagai tabel</summary>
              <table className="table mt-2">
                <thead>
                  <tr>
                    <th>Minggu</th>
                    <th className="!text-right">Rencana</th>
                    <th className="!text-right">Aktual</th>
                  </tr>
                </thead>
                <tbody>
                  {g.series.map((p) => (
                    <tr key={p.minggu}>
                      <td>{fmtTanggalPanjang(p.minggu)}</td>
                      <td className="num text-right">{rp(p.rencana)}</td>
                      <td className="num text-right">{p.aktual === null ? "–" : rp(p.aktual)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </>
        )}
      </Card>

      {g.status === "kurang" && (
        <Alert tone="warn">Proyeksi masih di bawah target minimal. Tahan belanja non-makan dan pindahkan sisa Darurat ke tabungan kalau memungkinkan.</Alert>
      )}

      <Card title="Ubah target" icon="pencil">
        <ActionForm action={simpanTarget} submit="Simpan target" submitClass="btn-secondary">
          <input type="hidden" name="id" value={g.goal.id} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="nama" className="label">
                Nama target
              </label>
              <input id="nama" name="nama" defaultValue={g.goal.nama} className="input" required />
            </div>
            <div>
              <label htmlFor="targetMin" className="label">
                Target minimal
              </label>
              <input id="targetMin" name="targetMin" defaultValue={g.goal.targetMin} className="input num" required />
            </div>
            <div>
              <label htmlFor="targetIdeal" className="label">
                Target ideal
              </label>
              <input id="targetIdeal" name="targetIdeal" defaultValue={g.goal.targetIdeal} className="input num" required />
            </div>
            <div>
              <label htmlFor="tenggat" className="label">
                Tenggat
              </label>
              <input id="tenggat" name="tenggat" type="date" defaultValue={g.goal.tenggat} className="input" required />
            </div>
          </div>
        </ActionForm>
      </Card>
    </div>
  );
}
