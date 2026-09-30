import Link from "next/link";
import AutoRefresh from "@/components/AutoRefresh";
import TransaksiItem from "@/components/TransaksiItem";
import { prisma } from "@/lib/db";
import { rp } from "@/lib/money";
import { listEnvelopes } from "@/lib/services/envelopes";
import { listTransactions } from "@/lib/services/transactions";
import { fmtRentang, fmtTanggalPanjang, namaHari, wibHM } from "@/lib/time";
import { ENVELOPE_KODE, type EnvelopeKode } from "@/lib/types";

export default async function RiwayatPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const [periods, envs] = await Promise.all([
    prisma.period.findMany({ where: { status: { not: "menunggu" } }, orderBy: { tanggalMulai: "desc" } }),
    listEnvelopes(prisma),
  ]);
  const periodId = sp.p ? Number(sp.p) : periods[0]?.id;
  const kode = ENVELOPE_KODE.includes(sp.k as EnvelopeKode) ? (sp.k as EnvelopeKode) : undefined;
  const period = periods.find((p) => p.id === periodId);

  const [txs, transfers] = await Promise.all([
    period ? listTransactions(prisma, { periodId: period.id, kode }) : Promise.resolve([]),
    period && !kode ? prisma.transfer.findMany({ where: { periodId: period.id }, include: { dari: true, ke: true }, orderBy: { id: "desc" } }) : Promise.resolve([]),
  ]);

  const perHari = new Map<string, typeof txs>();
  for (const t of txs) perHari.set(t.tanggal, [...(perHari.get(t.tanggal) ?? []), t]);
  const total = txs.reduce((s, t) => s + t.nominal, 0);
  const href = (p?: number, k?: string) => `/riwayat?${new URLSearchParams({ ...(p ? { p: String(p) } : {}), ...(k ? { k } : {}) })}`;
  const amplop = envs.map((e) => ({ kode: e.kode, nama: e.nama, terkunci: e.terkunci }));

  return (
    <main className="space-y-4">
      <AutoRefresh detik={5} />
      <h1 className="text-xl font-bold">Riwayat</h1>

      {periods.length === 0 ? (
        <p className="card text-sm text-muted">Belum ada periode. Catat uang masuk di Beranda dulu.</p>
      ) : (
        <>
          <nav aria-label="Periode" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            {periods.map((p) => (
              <Link
                key={p.id}
                href={href(p.id, kode)}
                aria-current={p.id === period?.id ? "true" : undefined}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-sm ${p.id === period?.id ? "border-brand bg-brand text-brand-fg" : "border-line bg-card"}`}
              >
                {fmtRentang(p.tanggalMulai, p.tanggalSelesai)}
              </Link>
            ))}
          </nav>
          <nav aria-label="Amplop" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            <Link href={href(period?.id)} className={`shrink-0 rounded-full border px-3 py-1.5 text-sm ${!kode ? "border-brand bg-brand text-brand-fg" : "border-line bg-card"}`}>
              Semua
            </Link>
            {envs.map((e) => (
              <Link key={e.kode} href={href(period?.id, e.kode)} className={`shrink-0 rounded-full border px-3 py-1.5 text-sm ${kode === e.kode ? "border-brand bg-brand text-brand-fg" : "border-line bg-card"}`}>
                {e.nama}
              </Link>
            ))}
          </nav>

          <p className="text-sm text-muted">
            {txs.length} transaksi · total <b className="text-fg">{rp(total)}</b>
          </p>

          {txs.length === 0 && transfers.length === 0 && <p className="card text-sm text-muted">Belum ada transaksi di sini.</p>}

          {[...perHari.entries()].map(([tgl, rows]) => (
            <section key={tgl} className="card !py-2">
              <h2 className="pt-1 text-sm font-semibold text-muted">
                {namaHari(tgl)}, {fmtTanggalPanjang(tgl)} · {rp(rows.reduce((s, r) => s + r.nominal, 0))}
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
                    }}
                    amplop={amplop}
                  />
                );
              })}
            </section>
          ))}

          {transfers.length > 0 && (
            <section className="card space-y-1 text-sm">
              <h2 className="font-semibold text-muted">Pindah antar amplop</h2>
              {transfers.map((t) => (
                <p key={t.id} className="flex justify-between">
                  <span>
                    {t.dari.nama} → {t.ke.nama} <span className="text-muted">({t.alasan})</span>
                  </span>
                  <b>{rp(t.nominal)}</b>
                </p>
              ))}
            </section>
          )}
        </>
      )}
    </main>
  );
}
