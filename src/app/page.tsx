import Link from "next/link";
import AutoRefresh from "@/components/AutoRefresh";
import EnvelopeList from "@/components/EnvelopeList";
import ProgressBar from "@/components/ProgressBar";
import UangMasukForm from "@/components/UangMasukForm";
import { ENVELOPE_ICON, Icon } from "@/components/icons";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { batalkanUangMasuk, konfirmasiUangMasuk, tandaiTanpaJajan } from "./actions";
import { prisma } from "@/lib/db";
import { TONE_TEXT, type Tone } from "@/lib/format";
import { rp } from "@/lib/money";
import { getDashboard } from "@/lib/services/dashboard";
import { getSetting } from "@/lib/services/settings";
import { fmtRentang, fmtTanggal, fmtTanggalPanjang, namaHari, wibHM } from "@/lib/time";
import type { EnvelopeKode } from "@/lib/types";

const NAMA: Record<EnvelopeKode, string> = { makan: "Makan", data: "Paket data", paylater: "Paylater", kado: "Tabungan kado", darurat: "Darurat & kos" };

export default async function Beranda() {
  const now = new Date();
  const [d, nama] = await Promise.all([getDashboard(prisma, now), getSetting(prisma, "nama_pengguna")]);
  const { jam } = wibHM(now);
  const sapa = jam < 11 ? "Selamat pagi" : jam < 15 ? "Selamat siang" : jam < 18 ? "Selamat sore" : "Selamat malam";

  return (
    <div className="space-y-5">
      <AutoRefresh />
      <PageHeader
        title={`${sapa}, ${nama}`}
        subtitle={
          <>
            {namaHari(d.hariIni)}, {fmtTanggalPanjang(d.hariIni)}
            {d.period && <> · Periode {fmtRentang(d.period.tanggalMulai, d.period.tanggalSelesai)}</>}
          </>
        }
        actions={
          <Link href="/catat" className="btn hidden lg:inline-flex">
            <Icon name="plus" size={18} />
            Catat pengeluaran
          </Link>
        }
      />

      {d.pending && (
        <Card title={`Usulan pembagian · uang masuk ${rp(d.pending.period.pemasukan)}`} icon="wallet" className="border-brand/40">
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {(Object.keys(NAMA) as EnvelopeKode[]).map((k) => (
              <li key={k} className="rounded-xl bg-subtle px-3 py-2.5">
                <p className="flex items-center gap-1.5 text-xs text-muted">
                  <Icon name={ENVELOPE_ICON[k]} size={14} />
                  {NAMA[k]}
                </p>
                <p className="num mt-0.5 font-semibold">{rp(d.pending!.alloc[k])}</p>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-muted">Konfirmasi setelah uang tabungan dipisah ke e-wallet.</p>
          <div className="mt-3 flex gap-2">
            <form action={konfirmasiUangMasuk} className="flex-1 sm:flex-none">
              <button className="btn w-full">
                <Icon name="check" size={18} />
                Konfirmasi
              </button>
            </form>
            <form action={batalkanUangMasuk}>
              <button className="btn-secondary">Batal</button>
            </form>
          </div>
        </Card>
      )}

      {!d.period && !d.pending && (
        <Card title="Uang mingguan sudah masuk?" icon="wallet">
          <p className="mb-3 text-sm text-muted">Masukkan nominalnya, nanti dibagi otomatis ke amplop sesuai rencana.</p>
          <UangMasukForm />
        </Card>
      )}

      {d.daily && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <JatahCard daily={d.daily} />
          <div className="grid grid-cols-2 gap-4 lg:col-span-2">
            <MiniStat icon="flame" label="Streak" value={`${d.streak} hari`} hint="catat berturut-turut" />
            <MiniStat icon="gift" label="Kado" value={d.goal ? `${Math.round(d.goal.persenMin)}%` : "-"} hint={d.goal ? rp(d.goal.saldo) : undefined} />
            <MiniStat icon="umbrella" label="Darurat" value={rp(d.balances.find((b) => b.kode === "darurat")?.saldo ?? 0)} hint="dana cadangan" />
            <MiniStat icon="shield" label="Diselamatkan" value={rp(d.hemat.total)} hint={`${d.hemat.jumlah} kali tahan belanja`} />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        {d.period && (
          <Card title="Amplop" icon="wallet" className="lg:col-span-3" action={<Link href="/amplop" className="text-sm font-medium text-brand">Kelola</Link>}>
            <EnvelopeList balances={d.balances} targetKado={d.goal?.goal.targetMin} tagihanPaylater={d.billPaylater} />
          </Card>
        )}

        <div className="space-y-4 lg:col-span-2">
          <Card title="Tagihan terdekat" icon="calendar" action={<Link href="/tagihan" className="text-sm font-medium text-brand">Semua</Link>}>
            {d.bills.length === 0 ? (
              <p className="text-sm text-muted">Tidak ada tagihan yang belum lunas.</p>
            ) : (
              <ul className="space-y-2.5">
                {d.bills.map((b) => {
                  const tone: Tone = b.hariLagi < 0 ? "bad" : b.hariLagi <= 3 ? "warn" : "ok";
                  return (
                    <li key={b.id} className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="num truncate text-sm font-semibold">
                          {b.nama} {rp(b.nominal)}
                        </p>
                        <p className="text-xs text-muted">
                          {fmtTanggalPanjang(b.jatuhTempo)}
                          {!b.tanggalPasti && " · perkiraan"}
                          {!b.envelope && " · di luar amplop"}
                        </p>
                      </div>
                      <Badge tone={tone} icon={tone === "ok" ? "clock" : "alert"}>
                        {b.hariLagi < 0 ? `Lewat ${-b.hariLagi} hr` : b.hariLagi === 0 ? "Hari ini" : `H-${b.hariLagi}`}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {d.goal && (
            <Card title="Target kado" icon="target" action={<Link href="/target" className="text-sm font-medium text-brand">Detail</Link>}>
              <div className="flex items-baseline justify-between">
                <p className="num text-2xl font-bold">{rp(d.goal.saldo)}</p>
                <p className="text-xs text-muted">{d.goal.hariLagi >= 0 ? `${d.goal.hariLagi} hari lagi` : "tenggat lewat"}</p>
              </div>
              <div className="mt-2">
                <ProgressBar persen={d.goal.persenMin} tone="brand" tebal label="Progres target kado" />
              </div>
              <p className="mt-2 text-xs text-muted">
                Minimal {rp(d.goal.goal.targetMin)} · proyeksi {rp(d.goal.proyeksi)}{" "}
                <Badge tone={d.goal.status === "kurang" ? "bad" : "ok"}>{d.goal.status === "kurang" ? "Kurang" : "Sesuai jalur"}</Badge>
              </p>
            </Card>
          )}

          {d.period && (
            <Card title="Hari ini" icon="receipt" action={<Link href="/riwayat" className="text-sm font-medium text-brand">Riwayat</Link>}>
              {d.txHariIni.length === 0 ? (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-muted">Belum ada catatan hari ini.</p>
                  <form action={tandaiTanpaJajan}>
                    <button className="btn-secondary btn-sm">Tidak jajan</button>
                  </form>
                </div>
              ) : (
                <ul className="space-y-2">
                  {d.txHariIni.map((t) => (
                    <li key={t.id} className="flex items-center justify-between gap-3 text-sm">
                      <span className="flex min-w-0 items-center gap-2">
                        <Icon name={ENVELOPE_ICON[t.envelope.kode]} size={15} className="shrink-0 text-muted" />
                        <span className="truncate">{t.catatan || "(tanpa catatan)"}</span>
                      </span>
                      <span className="num font-medium">{rp(t.nominal)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>
      </div>

      {!d.period && !d.pending && (
        <EmptyState icon="message" title="Catat lebih cepat lewat WhatsApp">
          Setelah bot tersambung, cukup kirim <code>tempe 5k</code> dan bot membalas sisa uang lo. Sambungkan di menu Koneksi WhatsApp.
        </EmptyState>
      )}
      {d.holdsMenunggu > 0 && (
        <p className="text-center text-sm text-muted">
          {d.holdsMenunggu} pembelian sedang ditahan.{" "}
          <Link href="/rekap#tahan" className="font-medium text-brand">
            Lihat
          </Link>
        </p>
      )}
    </div>
  );
}

function MiniStat({ icon, label, value, hint }: { icon: Parameters<typeof Icon>[0]["name"]; label: string; value: string; hint?: string }) {
  return (
    <div className="card p-3.5">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted">
        <Icon name={icon} size={15} />
        {label}
      </p>
      <p className="num mt-1 truncate text-lg font-bold">{value}</p>
      {hint && <p className="truncate text-xs text-muted">{hint}</p>}
    </div>
  );
}

function JatahCard({ daily }: { daily: NonNullable<Awaited<ReturnType<typeof getDashboard>>["daily"]> }) {
  const selesai = daily.hariSisa === 0;
  const tone: Tone = daily.sisaJatahHariIni < 0 ? "bad" : daily.jatahHariIni > 0 && daily.sisaJatahHariIni / daily.jatahHariIni < 0.3 ? "warn" : "ok";
  const label = tone === "bad" ? "Lewat jatah" : tone === "warn" ? "Menipis" : "Aman";
  return (
    <section className="card card-pad lg:col-span-3" aria-labelledby="jatah">
      <div className="flex items-center justify-between">
        <h2 id="jatah" className="flex items-center gap-2 text-sm font-medium text-muted">
          <Icon name="utensils" size={17} />
          Jatah makan hari ini
        </h2>
        {!selesai && (
          <Badge tone={tone} icon={tone === "ok" ? "check" : "alert"}>
            {label}
          </Badge>
        )}
      </div>
      {selesai ? (
        <p className="mt-3 text-lg font-semibold">Periode minggu ini sudah lewat. Catat uang masuk untuk mulai periode baru.</p>
      ) : (
        <>
          <p className={`num mt-2 text-[44px] font-extrabold leading-none tracking-tight ${tone === "ok" ? "" : TONE_TEXT[tone]}`}>{rp(daily.jatahHariIni)}</p>
          <div className="mt-4">
            <ProgressBar persen={daily.jatahHariIni ? (daily.makanHariIni / daily.jatahHariIni) * 100 : 0} tone={tone} tebal label="Terpakai hari ini" />
          </div>
          <div className="mt-2 flex justify-between text-sm">
            <span className="text-muted">
              Terpakai <b className="num text-fg">{rp(daily.makanHariIni)}</b>
            </span>
            <span className={`num font-medium ${TONE_TEXT[tone]}`}>
              {daily.sisaJatahHariIni >= 0 ? `Sisa ${rp(daily.sisaJatahHariIni)}` : `Lewat ${rp(-daily.sisaJatahHariIni)}`}
            </span>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4 text-sm">
            <div>
              <dt className="text-xs text-muted">Sisa amplop makan</dt>
              <dd className="num font-semibold">
                {rp(daily.saldoMakan)} <span className="font-normal text-muted">· {daily.hariSisa} hari</span>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Jatah besok</dt>
              <dd className="num font-semibold">{daily.hariSisa > 1 ? rp(daily.jatahBesok) : `Periode selesai ${fmtTanggal(daily.tanggalSelesai)}`}</dd>
            </div>
          </dl>
        </>
      )}
    </section>
  );
}
