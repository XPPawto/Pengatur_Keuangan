import Link from "next/link";
import CatatForm from "@/components/CatatForm";
import { prisma } from "@/lib/db";
import { rp } from "@/lib/money";
import { listEnvelopes } from "@/lib/services/envelopes";
import { getCurrentPeriod } from "@/lib/services/periods";
import { tandaiTanpaJajan } from "../actions";

export default async function CatatPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const [envs, items, period] = await Promise.all([
    listEnvelopes(prisma),
    prisma.shoppingItem.findMany({ where: { aktif: true, hargaSatuan: { gt: 0 } }, orderBy: { urutan: "asc" } }),
    getCurrentPeriod(prisma),
  ]);
  const cepat = items.filter((i) => i.envelopeKode === "makan" && i.jumlah > 0).slice(0, 8);

  return (
    <main className="space-y-4">
      <h1 className="text-xl font-bold">Catat pengeluaran</h1>
      {!period && (
        <p className="rounded-xl bg-warn-bg px-3 py-2 text-sm text-warn">
          Belum ada periode aktif. Catat uang masuk dulu di <Link href="/" className="underline">Beranda</Link>.
        </p>
      )}

      <section aria-label="Belanja cepat" className="flex flex-wrap gap-2">
        {cepat.map((i) => {
          const nama = i.nama.split(/[\s/(]/)[0].toLowerCase();
          const nominal = i.hargaSatuan <= 10000 ? i.hargaSatuan : "";
          return (
            <Link
              key={i.id}
              href={`/catat?catatan=${encodeURIComponent(nama)}&kode=${i.envelopeKode}&nominal=${nominal}`}
              className="rounded-full border border-line bg-card px-3 py-1.5 text-sm"
            >
              {nama}
              {nominal !== "" && <span className="text-muted"> {rp(Number(nominal))}</span>}
            </Link>
          );
        })}
      </section>

      <CatatForm
        key={`${sp.catatan}-${sp.nominal}-${sp.kode}`}
        amplop={envs.map((e) => ({ kode: e.kode, nama: e.nama, terkunci: e.terkunci }))}
        awal={{ catatan: sp.catatan, nominal: sp.nominal, kode: sp.kode }}
      />

      <form action={tandaiTanpaJajan}>
        <button className="btn-ghost w-full">Hari ini gak jajan</button>
      </form>
    </main>
  );
}
