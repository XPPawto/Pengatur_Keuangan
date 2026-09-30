import ActionForm from "@/components/ActionForm";
import StackedColumns from "@/components/charts/StackedColumns";
import { Icon } from "@/components/icons";
import { Badge, Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import { prisma } from "@/lib/db";
import { rp } from "@/lib/money";
import { getStreak } from "@/lib/services/daily";
import { listHolds, savedTotal } from "@/lib/services/holds";
import { getCurrentPeriod } from "@/lib/services/periods";
import { weeklyStats } from "@/lib/services/reports";
import { addDays, fmtRentang, fmtTanggal, fmtTanggalPanjang, HARI, wibDate, weekdayOf } from "@/lib/time";
import { putuskanTahan, tahanBelanja } from "../actions-lain";

export const metadata = { title: "Rekap" };

const SERI = [
  { key: "makan", label: "Makan", color: "var(--series-1)" },
  { key: "data", label: "Paket data", color: "var(--series-2)" },
  { key: "paylater", label: "Paylater", color: "var(--series-3)" },
  { key: "kado", label: "Tabungan kado", color: "var(--series-4)" },
  { key: "darurat", label: "Darurat & kos", color: "var(--series-5)" },
];

export default async function RekapPage() {
  const now = new Date();
  const [weeks, hemat, holds, streak, period] = await Promise.all([weeklyStats(prisma, now, 12), savedTotal(prisma), listHolds(prisma, 30), getStreak(prisma, now), getCurrentPeriod(prisma)]);
  const ini = weeks[weeks.length - 1];

  // makan per hari minggu ini
  let perHari: { label: string; makan: number }[] = [];
  let rataJatah = 0;
  if (period) {
    const makan = await prisma.transaction.groupBy({ by: ["tanggal"], where: { periodId: period.id, envelope: { kode: "makan" } }, _sum: { nominal: true } });
    const alok = ini?.perAmplop.find((a) => a.kode === "makan")?.alokasi ?? 0;
    rataJatah = Math.floor(alok / 7 / 100) * 100;
    perHari = Array.from({ length: 7 }, (_, i) => {
      const tgl = addDays(period.tanggalMulai, i);
      return { label: HARI[weekdayOf(tgl)].slice(0, 3), makan: makan.find((m) => m.tanggal === tgl)?._sum.nominal ?? 0 };
    });
  }

  const totalSemua = weeks.reduce((s, w) => s + w.totalKeluar, 0);
  const rataMakan = weeks.length ? Math.round(weeks.reduce((s, w) => s + w.makan, 0) / weeks.reduce((s, w) => s + w.hariBerjalan, 0)) : 0;
  const menunggu = holds.filter((h) => h.hasil === "menunggu");

  return (
    <div className="space-y-5">
      <PageHeader
        title="Rekap"
        subtitle={ini ? `Minggu ini ${fmtRentang(ini.period.tanggalMulai, ini.period.tanggalSelesai)}` : "Belum ada data"}
        actions={
          <a href="/api/export/xlsx" className="btn-secondary btn-sm">
            <Icon name="download" size={16} />
            Excel
          </a>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon="utensils" label="Rata-rata makan/hari" value={rp(ini?.rataMakanPerHari ?? 0)} hint={`semua periode ${rp(rataMakan)}`} tone={ini && ini.makan > (ini.perAmplop.find((a) => a.kode === "makan")?.alokasi ?? 0) ? "bad" : undefined} />
        <Stat icon="flame" label="Disiplin minggu ini" value={ini ? `${ini.hariDisiplin}/${ini.hariBerjalan} hari` : "–"} hint={`streak ${streak} hari · target ≥ 6/7`} tone={ini && ini.hariBerjalan >= 7 && ini.hariDisiplin < 6 ? "warn" : undefined} />
        <Stat icon="shield" label="Diselamatkan" value={rp(hemat.total)} hint={`${hemat.jumlah}× tidak jadi beli`} />
        <Stat icon="receipt" label="Total pengeluaran" value={rp(totalSemua)} hint={`${weeks.length} minggu terakhir`} />
      </div>

      {weeks.length === 0 ? (
        <EmptyState icon="chart" title="Belum ada data rekap">
          Grafik muncul setelah periode pertama berjalan.
        </EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Card title="Pengeluaran per amplop per minggu" icon="chart">
            <StackedColumns
              title="Pengeluaran per amplop per minggu"
              labels={weeks.map((w) => fmtTanggal(w.period.tanggalMulai))}
              series={SERI}
              data={weeks.map((w) => Object.fromEntries(w.perAmplop.map((a) => [a.kode, a.terpakai])))}
            />
            <TableView
              head={["Minggu", ...SERI.map((s) => s.label), "Total"]}
              rows={weeks.map((w) => [fmtRentang(w.period.tanggalMulai, w.period.tanggalSelesai), ...SERI.map((s) => rp(w.perAmplop.find((a) => a.kode === s.key)?.terpakai ?? 0)), rp(w.totalKeluar)])}
            />
          </Card>
          {period && (
            <Card title="Makan per hari minggu ini" icon="utensils">
              <StackedColumns
                title="Pengeluaran makan per hari minggu ini"
                labels={perHari.map((p) => p.label)}
                series={[{ key: "makan", label: "Makan", color: "var(--series-1)" }]}
                data={perHari.map((p) => ({ makan: p.makan }))}
                refLine={{ value: rataJatah, label: "Jatah" }}
              />
              <TableView head={["Hari", "Makan"]} rows={perHari.map((p) => [p.label, rp(p.makan)])} />
            </Card>
          )}
        </div>
      )}

      <Card title="Mode tahan belanja" icon="pause" className="scroll-mt-6" >
        <div id="tahan" className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div>
            <p className="mb-3 text-sm text-muted">Mau beli sesuatu di luar makan & data? Tahan 24 jam dulu. Kalau besok nggak jadi, uangnya dihitung sebagai yang diselamatkan.</p>
            <ActionForm action={tahanBelanja} submit={<><Icon name="pause" size={16} />Tahan 24 jam</>} resetOnOk>
              <div className="grid grid-cols-[1fr_120px] gap-2">
                <div>
                  <label htmlFor="barang" className="label">
                    Barang
                  </label>
                  <input id="barang" name="barang" required placeholder="headset" className="input" />
                </div>
                <div>
                  <label htmlFor="harga" className="label">
                    Harga
                  </label>
                  <input id="harga" name="nominal" required placeholder="60k" className="input num" />
                </div>
              </div>
            </ActionForm>
          </div>
          <div>
            <h3 className="section-title mb-2">Sedang ditahan ({menunggu.length})</h3>
            {menunggu.length === 0 ? (
              <p className="text-sm text-muted">Tidak ada.</p>
            ) : (
              <ul className="space-y-2">
                {menunggu.map((h) => (
                  <li key={h.id} className="rounded-xl border border-line p-3">
                    <div className="flex justify-between gap-2 text-sm">
                      <span className="font-semibold">{h.barang}</span>
                      <span className="num font-semibold">{rp(h.nominal)}</span>
                    </div>
                    <p className="text-xs text-muted">Ditanya ulang {fmtTanggalPanjang(wibDate(h.tanyaUlangPada))}</p>
                    <form action={putuskanTahan} className="mt-2 flex gap-2">
                      <input type="hidden" name="id" value={h.id} />
                      <button name="keputusan" value="batal" className="btn btn-sm">
                        <Icon name="shield" size={15} />
                        Gak jadi
                      </button>
                      <button name="keputusan" value="beli" className="btn-secondary btn-sm">
                        Jadi beli
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        {holds.some((h) => h.hasil !== "menunggu") && (
          <>
            <h3 className="section-title mb-2 mt-5">Riwayat</h3>
            <ul className="divide-y divide-line text-sm">
              {holds
                .filter((h) => h.hasil !== "menunggu")
                .map((h) => (
                  <li key={h.id} className="flex items-center justify-between gap-3 py-2">
                    <span>
                      {h.barang} <span className="num text-muted">{rp(h.nominal)}</span>
                    </span>
                    <Badge tone={h.hasil === "batal" ? "ok" : "neutral"}>{h.hasil === "batal" ? "Diselamatkan" : "Dibeli"}</Badge>
                  </li>
                ))}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}

function TableView({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-sm font-medium text-brand">Lihat sebagai tabel</summary>
      <div className="-mx-4 mt-2 overflow-x-auto sm:mx-0">
        <table className="table min-w-[480px]">
          <thead>
            <tr>
              {head.map((h, i) => (
                <th key={h} className={i ? "!text-right" : ""}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r[0]}>
                {r.map((c, i) => (
                  <td key={i} className={i ? "num text-right" : "whitespace-nowrap"}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
