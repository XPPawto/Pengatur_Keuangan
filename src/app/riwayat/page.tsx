import Link from "next/link";
import AutoRefresh from "@/components/AutoRefresh";
import TransaksiItem from "@/components/TransaksiItem";
import { Icon } from "@/components/icons";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { prisma } from "@/lib/db";
import { rp } from "@/lib/money";
import { listEnvelopes } from "@/lib/services/envelopes";
import { listTransactions } from "@/lib/services/transactions";
import { fmtRentang, fmtTanggalPanjang, namaHari, wibHM } from "@/lib/time";
import { ENVELOPE_KODE, type EnvelopeKode } from "@/lib/types";

export const metadata = { title: "Riwayat" };

export default async function RiwayatPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const [periods, envs] = await Promise.all([
    prisma.period.findMany({ where: { status: { not: "menunggu" } }, orderBy: { tanggalMulai: "desc" } }),
    listEnvelopes(prisma),
  ]);
  const periodId = sp.p ? Number(sp.p) : periods[0]?.id;
  const kode = ENVELOPE_KODE.includes(sp.k as EnvelopeKode) ? (sp.k as EnvelopeKode) : undefined;
  const cari = (sp.q ?? "").trim().toLowerCase();
  const period = periods.find((p) => p.id === periodId);

  const [semua, transfers] = await Promise.all([
    period ? listTransactions(prisma, { periodId: period.id, kode }) : Promise.resolve([]),
    period && !kode ? prisma.transfer.findMany({ where: { periodId: period.id }, include: { dari: true, ke: true }, orderBy: { id: "desc" } }) : Promise.resolve([]),
  ]);
  const txs = cari ? semua.filter((t) => t.catatan.toLowerCase().includes(cari)) : semua;

  const perHari = new Map<string, typeof txs>();
  for (const t of txs) perHari.set(t.tanggal, [...(perHari.get(t.tanggal) ?? []), t]);
  const total = txs.reduce((s, t) => s + t.nominal, 0);
  const href = (p?: number, k?: string) => `/riwayat?${new URLSearchParams({ ...(p ? { p: String(p) } : {}), ...(k ? { k } : {}), ...(cari ? { q: cari } : {}) })}`;
  const amplop = envs.map((e) => ({ kode: e.kode, nama: e.nama, terkunci: e.terkunci }));

  return (
    <div className="space-y-4">
      <AutoRefresh detik={5} />
      <PageHeader
        title="Riwayat"
        subtitle={period ? `Periode ${fmtRentang(period.tanggalMulai, period.tanggalSelesai)}` : undefined}
        actions={
          <a href="/api/export/csv" className="btn-secondary btn-sm">
            <Icon name="download" size={16} />
            CSV
          </a>
        }
      />

      {periods.length === 0 ? (
        <EmptyState icon="receipt" title="Belum ada transaksi" href="/" cta="Ke Beranda">
          Catat uang masuk dulu di Beranda untuk memulai periode pertama.
        </EmptyState>
      ) : (
        <>
          <div className="space-y-2">
            <nav aria-label="Periode" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
              {periods.map((p) => (
                <Link key={p.id} href={href(p.id, kode)} aria-current={p.id === period?.id ? "true" : undefined} className={`chip ${p.id === period?.id ? "chip-active" : ""}`}>
                  {fmtRentang(p.tanggalMulai, p.tanggalSelesai)}
                </Link>
              ))}
            </nav>
            <nav aria-label="Amplop" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
              <Link href={href(period?.id)} className={`chip ${!kode ? "chip-active" : ""}`}>
                Semua
              </Link>
              {envs.map((e) => (
                <Link key={e.kode} href={href(period?.id, e.kode)} className={`chip ${kode === e.kode ? "chip-active" : ""}`}>
                  {e.nama}
                </Link>
              ))}
            </nav>
            <form className="relative" action="/riwayat">
              {period && <input type="hidden" name="p" value={period.id} />}
              {kode && <input type="hidden" name="k" value={kode} />}
              <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <label htmlFor="q" className="sr-only">
                Cari catatan
              </label>
              <input id="q" name="q" defaultValue={cari} placeholder="Cari catatan, mis. telur" className="input !pl-9" />
            </form>
          </div>

          <div className="flex items-center justify-between text-sm">
            <span className="text-muted">{txs.length} transaksi</span>
            <span>
              Total <b className="num">{rp(total)}</b>
            </span>
          </div>

          {txs.length === 0 && transfers.length === 0 && <EmptyState icon="receipt" title="Tidak ada transaksi di filter ini" />}

          {[...perHari.entries()].map(([tgl, rows]) => (
            <Card key={tgl} className="!py-2">
              <h2 className="flex justify-between border-b border-line py-2 text-[13px] font-semibold text-muted">
                <span>
                  {namaHari(tgl)}, {fmtTanggalPanjang(tgl)}
                </span>
                <span className="num">{rp(rows.reduce((s, r) => s + r.nominal, 0))}</span>
              </h2>
              {rows.map((t) => {
                const { jam, menit } = wibHM(t.dibuatPada);
                return (
                  <TransaksiItem
                    key={t.id}
                    tx={{
                      id: t.id,
                      nominal: t.nominal,
                      catatan: t.catatan,
                      sumber: t.sumber,
                      kode: t.envelope.kode,
                      namaAmplop: t.envelope.nama,
                      jam: `${String(jam).padStart(2, "0")}.${String(menit).padStart(2, "0")}`,
                      pesanAsli: t.pesanAsli,
                    }}
                    amplop={amplop}
                  />
                );
              })}
            </Card>
          ))}

          {transfers.length > 0 && !cari && (
            <Card title="Pindah antar amplop" icon="transfer">
              <ul className="space-y-2 text-sm">
                {transfers.map((t) => (
                  <li key={t.id} className="flex justify-between gap-3">
                    <span className="min-w-0">
                      {t.dari.nama} → {t.ke.nama}
                      <span className="block truncate text-xs text-muted">{t.alasan}</span>
                    </span>
                    <b className="num shrink-0">{rp(t.nominal)}</b>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
