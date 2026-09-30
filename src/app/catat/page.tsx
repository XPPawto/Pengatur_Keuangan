import Link from "next/link";
import CatatForm from "@/components/CatatForm";
import { Icon } from "@/components/icons";
import { Alert, Card, PageHeader } from "@/components/ui";
import { prisma } from "@/lib/db";
import { rp } from "@/lib/money";
import { listEnvelopes } from "@/lib/services/envelopes";
import { getCurrentPeriod } from "@/lib/services/periods";
import { wibDate } from "@/lib/time";
import { tandaiTanpaJajan } from "../actions";

export const metadata = { title: "Catat" };

export default async function CatatPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const [envs, items, period] = await Promise.all([
    listEnvelopes(prisma),
    prisma.shoppingItem.findMany({ where: { aktif: true, hargaSatuan: { gt: 0 } }, orderBy: { urutan: "asc" } }),
    getCurrentPeriod(prisma),
  ]);
  const cepat = items.filter((i) => i.envelopeKode === "makan" && i.jumlah > 0).slice(0, 9);
  const hariIni = wibDate(new Date());

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader title="Catat pengeluaran" subtitle="Atau kirim ke bot WhatsApp, misalnya: tempe 5k sama telur 14k" />
      {!period && (
        <Alert tone="warn">
          Belum ada periode aktif. Catat uang masuk dulu di{" "}
          <Link href="/" className="font-semibold underline">
            Beranda
          </Link>
          .
        </Alert>
      )}

      <section aria-labelledby="cepat">
        <h2 id="cepat" className="section-title mb-2">
          Belanja cepat
        </h2>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
          {cepat.map((i) => {
            const nama = i.nama.split(/[\s/(]/)[0].toLowerCase();
            const nominal = i.hargaSatuan <= 12000 ? i.hargaSatuan : "";
            const aktif = sp.catatan === nama;
            return (
              <Link key={i.id} href={`/catat?catatan=${encodeURIComponent(nama)}&kode=${i.envelopeKode}&nominal=${nominal}`} className={`chip ${aktif ? "chip-active" : ""}`}>
                <span className="capitalize">{nama}</span>
                {nominal !== "" && <span className="num text-muted">{rp(Number(nominal))}</span>}
              </Link>
            );
          })}
        </div>
      </section>

      <CatatForm
        key={`${sp.catatan}-${sp.nominal}-${sp.kode}`}
        amplop={envs.map((e) => ({ kode: e.kode, nama: e.nama, terkunci: e.terkunci }))}
        awal={{ catatan: sp.catatan, nominal: sp.nominal, kode: sp.kode }}
        tanggal={{ hariIni, min: period?.tanggalMulai ?? hariIni }}
      />

      <Card>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">Hari ini tidak jajan?</p>
            <p className="text-xs text-muted">Tetap dihitung disiplin supaya streak tidak putus.</p>
          </div>
          <form action={tandaiTanpaJajan}>
            <button className="btn-secondary btn-sm">
              <Icon name="check" size={16} />
              Tandai
            </button>
          </form>
        </div>
      </Card>
    </div>
  );
}
