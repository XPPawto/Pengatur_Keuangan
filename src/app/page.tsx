import AutoRefresh from "@/components/AutoRefresh";
import ProgressBar from "@/components/ProgressBar";
import UangMasukForm from "@/components/UangMasukForm";
import { batalkanUangMasuk, konfirmasiUangMasuk, logout, tandaiTanpaJajan } from "./actions";
import { prisma } from "@/lib/db";
import { TONE_SOFT, TONE_TEXT, toneFor, type Tone } from "@/lib/format";
import { rp } from "@/lib/money";
import { getDashboard } from "@/lib/services/dashboard";
import { fmtRentang, fmtTanggal, fmtTanggalPanjang } from "@/lib/time";
import type { EnvelopeKode } from "@/lib/types";

const NAMA: Record<EnvelopeKode, string> = { makan: "Makan", data: "Paket data", paylater: "Paylater", kado: "Tabungan kado", darurat: "Darurat & kos" };

export default async function Beranda() {
  const d = await getDashboard(prisma, new Date());

  return (
    <main className="space-y-4">
      <AutoRefresh />
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">DompetKos</h1>
          <p className="text-sm text-muted">
            {d.period ? `Periode ${fmtRentang(d.period.tanggalMulai, d.period.tanggalSelesai)}` : "Belum ada periode aktif"}
          </p>
        </div>
        <form action={logout}>
          <button className="btn-ghost text-muted" type="submit">
            Keluar
          </button>
        </form>
      </header>

      {d.pending && (
        <section className="card space-y-3 border-brand" aria-labelledby="usulan">
          <h2 id="usulan" className="font-semibold">
            Usulan pembagian — uang masuk {rp(d.pending.period.pemasukan)}
          </h2>
          <ul className="divide-y divide-line text-sm">
            {(Object.keys(NAMA) as EnvelopeKode[]).map((k) => (
              <li key={k} className="flex justify-between py-1.5">
                <span>{NAMA[k]}</span>
                <span className="font-medium">{rp(d.pending!.alloc[k])}</span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted">Konfirmasi setelah uangnya dipisah ke e-wallet tabungan.</p>
          <div className="flex gap-2">
            <form action={konfirmasiUangMasuk} className="flex-1">
              <button className="btn w-full">Konfirmasi</button>
            </form>
            <form action={batalkanUangMasuk}>
              <button className="btn-ghost">Batal</button>
            </form>
          </div>
        </section>
      )}

      {!d.period && !d.pending && (
        <section className="card space-y-3">
          <h2 className="font-semibold">Uang mingguan udah masuk?</h2>
          <UangMasukForm />
        </section>
      )}

      {d.daily && <JatahCard daily={d.daily} />}

      {d.period && (
        <section className="card space-y-4" aria-labelledby="amplop">
          <h2 id="amplop" className="font-semibold">
            Amplop
          </h2>
          {d.balances.map((b) => {
            let persen = 0;
            let tone: Tone | "brand" = "brand";
            let info = "";
            if (b.kode === "kado" && d.goal) {
              persen = (b.saldo / d.goal.targetMin) * 100;
              info = `dari target ${rp(d.goal.targetMin)}`;
            } else if (b.kode === "paylater" && d.billPaylater) {
              persen = (b.saldo / Math.max(1, d.billPaylater.nominal)) * 100;
              info = `buat tagihan ${rp(d.billPaylater.nominal)} (${fmtTanggal(d.billPaylater.jatuhTempo)}) · ${b.saldo >= d.billPaylater.nominal ? "cukup" : `kurang ${rp(d.billPaylater.nominal - b.saldo)}`}`;
            } else if (!b.kumulatif) {
              persen = b.alokasi ? (b.saldo / b.alokasi) * 100 : 0;
              tone = toneFor(b.saldo, b.alokasi);
              info = `dari ${rp(b.alokasi)}`;
            } else {
              info = `tabungan · +${rp(b.alokasi)} minggu ini`;
            }
            return (
              <div key={b.kode}>
                <div className="mb-1.5 flex items-baseline justify-between gap-2">
                  <span className="font-medium">
                    {NAMA[b.kode]} {b.terkunci && <span title="Terkunci" aria-label="terkunci">🔒</span>}
                  </span>
                  <span className={`font-semibold ${tone === "brand" ? "" : TONE_TEXT[tone]}`}>{rp(b.saldo)}</span>
                </div>
                {b.kode !== "darurat" && <ProgressBar persen={persen} tone={tone} label={NAMA[b.kode]} />}
                <p className="mt-1 text-xs text-muted">{info}</p>
              </div>
            );
          })}
        </section>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {d.bill && (
          <section className="card" aria-labelledby="tagihan">
            <h2 id="tagihan" className="text-sm font-medium text-muted">
              Tagihan terdekat
            </h2>
            <p className="mt-1 text-2xl font-bold">{rp(d.bill.nominal)}</p>
            <p className="text-sm">
              {d.bill.nama} · {fmtTanggalPanjang(d.bill.jatuhTempo)}
              {!d.bill.tanggalPasti && <span className="text-muted"> (tanggal belum pasti)</span>}
            </p>
            <p className={`mt-2 inline-block rounded-lg px-2 py-0.5 text-sm font-medium ${TONE_SOFT[d.bill.hariLagi < 0 ? "bad" : d.bill.hariLagi <= 3 ? "warn" : "ok"]}`}>
              {d.bill.hariLagi < 0 ? `Lewat ${-d.bill.hariLagi} hari` : d.bill.hariLagi === 0 ? "Hari ini!" : `H-${d.bill.hariLagi}`}
            </p>
          </section>
        )}
        {d.goal && (
          <section className="card space-y-1" aria-labelledby="target">
            <h2 id="target" className="text-sm font-medium text-muted">
              Target kado
            </h2>
            <p className="text-2xl font-bold">{rp(d.goal.saldo)}</p>
            <ProgressBar persen={(d.goal.saldo / d.goal.targetMin) * 100} tone="brand" label="Progres target kado" />
            <p className="text-sm text-muted">
              Min {rp(d.goal.targetMin)}, ideal {rp(d.goal.targetIdeal)} · {d.goal.hariLagi >= 0 ? `${d.goal.hariLagi} hari lagi` : "tenggat lewat"} ({fmtTanggalPanjang(d.goal.tenggat)})
            </p>
          </section>
        )}
      </div>

      <section className="card flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-muted">Streak disiplin</p>
          <p className="text-2xl font-bold">{d.streak} hari 🔥</p>
        </div>
        <form action={tandaiTanpaJajan}>
          <button className="btn-ghost">Hari ini gak jajan</button>
        </form>
      </section>
    </main>
  );
}

function JatahCard({ daily }: { daily: NonNullable<Awaited<ReturnType<typeof getDashboard>>["daily"]> }) {
  const selesai = daily.hariSisa === 0;
  const tone: Tone = daily.sisaJatahHariIni < 0 ? "bad" : daily.jatahHariIni > 0 && daily.sisaJatahHariIni / daily.jatahHariIni < 0.3 ? "warn" : "ok";
  return (
    <section className="card" aria-labelledby="jatah">
      <h2 id="jatah" className="text-sm font-medium text-muted">
        Jatah makan hari ini
      </h2>
      {selesai ? (
        <p className="mt-1 text-lg font-semibold">Periode minggu ini udah lewat. Catat uang masuk buat mulai lagi.</p>
      ) : (
        <>
          <p className={`mt-1 text-4xl font-extrabold tracking-tight ${TONE_TEXT[tone]}`}>{rp(daily.jatahHariIni)}</p>
          <p className="mt-2 text-sm">
            Kepake <b>{rp(daily.makanHariIni)}</b> ·{" "}
            <span className={TONE_TEXT[tone]}>{daily.sisaJatahHariIni >= 0 ? `sisa ${rp(daily.sisaJatahHariIni)}` : `lewat ${rp(-daily.sisaJatahHariIni)}`}</span>
          </p>
          <p className="mt-1 text-sm text-muted">
            Sisa makan {rp(daily.saldoMakan)} buat {daily.hariSisa} hari
            {daily.hariSisa > 1 ? ` · jatah besok ${rp(daily.jatahBesok)}` : ""}
          </p>
        </>
      )}
    </section>
  );
}
