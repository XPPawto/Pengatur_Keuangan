import ActionForm from "@/components/ActionForm";
import EnvelopeList from "@/components/EnvelopeList";
import { ENVELOPE_ICON, Icon } from "@/components/icons";
import { Alert, Card, PageHeader, Stat } from "@/components/ui";
import { prisma } from "@/lib/db";
import { rp } from "@/lib/money";
import { getBalances, listEnvelopes } from "@/lib/services/envelopes";
import { getGoalProgress } from "@/lib/services/goals";
import { getCurrentPeriod, getPeriodAllocations, listPlans } from "@/lib/services/periods";
import { fmtRentang, fmtTanggalPanjang } from "@/lib/time";
import { ENVELOPE_KODE, type EnvelopeKode } from "@/lib/types";
import { pindahAmplop, simpanAlokasi, simpanPengaturanAmplop, simpanRencana } from "../actions-keuangan";
import { koreksiPemasukan } from "../actions-plus";
import RekonForm from "@/components/RekonForm";
import { riwayatRekonsiliasi, saldoSistem } from "@/lib/services/reconcile";

export const metadata = { title: "Amplop & anggaran" };

const JENIS: Record<string, string> = { daily: "Harian", fixed: "Tetap", sinking: "Sinking fund", goal: "Tujuan", remainder: "Sisa otomatis" };

export default async function AmplopPage() {
  const now = new Date();
  const period = await getCurrentPeriod(prisma);
  const [sistem, rekonLalu] = await Promise.all([saldoSistem(prisma), riwayatRekonsiliasi(prisma, 5)]);
  const [envs, balances, goal, plans, alloc, bill] = await Promise.all([
    listEnvelopes(prisma),
    getBalances(prisma, period?.id ?? null),
    getGoalProgress(prisma, now),
    listPlans(prisma),
    period ? getPeriodAllocations(prisma, period.id) : Promise.resolve(null),
    prisma.bill.findFirst({ where: { status: "belum", envelope: { kode: "paylater" } }, orderBy: { jatuhTempo: "asc" } }),
  ]);
  const totalAlokasi = alloc ? Object.values(alloc).reduce((a, b) => a + b, 0) : 0;
  const nama = (k: string) => envs.find((e) => e.kode === k)?.nama ?? k;

  return (
    <div className="space-y-5">
      <PageHeader title="Amplop & anggaran" subtitle={period ? `Periode ${fmtRentang(period.tanggalMulai, period.tanggalSelesai)}` : "Belum ada periode aktif"} />

      {period && alloc && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat icon="wallet" label="Pemasukan minggu ini" value={rp(period.pemasukan + period.tambahan)} hint={period.tambahan ? `mingguan ${rp(period.pemasukan)} + tambahan ${rp(period.tambahan)}` : "uang mingguan"} />
          <Stat icon="grid" label="Total dialokasikan" value={rp(totalAlokasi)} tone={totalAlokasi > period.pemasukan + period.tambahan ? "bad" : undefined} />
          <Stat icon="receipt" label="Terpakai minggu ini" value={rp(balances.filter((b) => !b.kumulatif).reduce((s, b) => s + b.terpakai, 0))} hint="Makan + Data" />
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card title="Saldo amplop" icon="wallet">
          <EnvelopeList balances={balances} targetKado={goal?.goal.targetMin} tagihanPaylater={bill} />
        </Card>

        <div className="space-y-5">
          <Card title="Pindah antar amplop" icon="transfer">
            {period ? (
              <ActionForm action={pindahAmplop} submit="Pindahkan" resetOnOk>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="dari" className="label">
                      Dari
                    </label>
                    <select id="dari" name="dari" className="input" defaultValue="darurat">
                      {envs.map((e) => (
                        <option key={e.kode} value={e.kode}>
                          {e.nama}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="ke" className="label">
                      Ke
                    </label>
                    <select id="ke" name="ke" className="input" defaultValue="makan">
                      {envs.map((e) => (
                        <option key={e.kode} value={e.kode}>
                          {e.nama}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-[120px_1fr] gap-3">
                  <div>
                    <label htmlFor="nominal-pindah" className="label">
                      Nominal
                    </label>
                    <input id="nominal-pindah" name="nominal" placeholder="10k" required className="input num" />
                  </div>
                  <div>
                    <label htmlFor="alasan" className="label">
                      Alasan
                    </label>
                    <input id="alasan" name="alasan" placeholder="wajib, supaya tercatat" required className="input" />
                  </div>
                </div>
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted">Ambil dari Tabungan kado (terkunci)?</summary>
                  <label htmlFor="konfirmasi-pindah" className="label mt-2">
                    Ketik <b>YAKIN AMBIL TABUNGAN</b>
                  </label>
                  <input id="konfirmasi-pindah" name="konfirmasi" className="input" autoComplete="off" />
                </details>
              </ActionForm>
            ) : (
              <p className="text-sm text-muted">Tersedia setelah periode aktif.</p>
            )}
          </Card>

          {period && alloc && (
            <Card title="Alokasi periode ini" icon="grid">
              <ActionForm action={simpanAlokasi} submit="Simpan alokasi" submitClass="btn-secondary">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {ENVELOPE_KODE.map((k) => (
                    <div key={k}>
                      <label htmlFor={`alokasi_${k}`} className="label flex items-center gap-1.5">
                        <Icon name={ENVELOPE_ICON[k]} size={14} />
                        {nama(k).split(" ")[0]}
                      </label>
                      <input id={`alokasi_${k}`} name={`alokasi_${k}`} defaultValue={alloc[k]} className="input-sm num" />
                    </div>
                  ))}
                </div>
                <p className="hint">Koreksi manual. Idealnya total = pemasukan {rp(period.pemasukan)}.</p>
              </ActionForm>
            </Card>
          )}
        </div>
      </div>

      {period && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Card title="Cocokkan dengan uang asli" icon="scale">
            <RekonForm saldoSistem={sistem} />
            {rekonLalu.length > 0 && (
              <ul className="mt-4 divide-y divide-line border-t border-line text-xs">
                {rekonLalu.map((r) => (
                  <li key={r.id} className="flex justify-between gap-2 py-1.5">
                    <span className="text-muted">{fmtTanggalPanjang(r.waktu.toISOString().slice(0, 10))}</span>
                    <span className="num">
                      {r.selisih === 0 ? "cocok" : `${r.selisih > 0 ? "+" : ""}${rp(r.selisih)}`} · {r.tindakan || "belum diselesaikan"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Koreksi uang mingguan" icon="pencil">
            <p className="mb-3 text-sm text-muted">Salah ketik nominal saat `masuk`? Selisihnya otomatis masuk/keluar dari Darurat, amplop lain tidak berubah.</p>
            <ActionForm action={koreksiPemasukan} submit="Simpan koreksi" submitClass="btn-secondary">
              <label htmlFor="koreksi-nominal" className="label">
                Uang mingguan yang benar
              </label>
              <input id="koreksi-nominal" name="nominal" defaultValue={period.pemasukan} className="input num" />
            </ActionForm>
          </Card>
        </div>
      )}

      <Card title="Aturan amplop" icon="settings">
        <p className="mb-3 text-sm text-muted">
          Urutan potong dipakai saat uang masuk kurang dari rencana (1 dipotong pertama). Makan & Data tidak pernah dipotong otomatis.
        </p>
        <div className="divide-y divide-line">
          {envs.map((e) => (
            <ActionForm key={e.kode} action={simpanPengaturanAmplop} submit="Simpan" submitClass="btn-secondary btn-sm self-end" className="grid grid-cols-2 items-end gap-3 py-3 sm:grid-cols-[1.4fr_1fr_1fr_1fr_auto]">
              <input type="hidden" name="kode" value={e.kode} />
              <div className="col-span-2 flex items-center gap-2.5 sm:col-span-1">
                <span className="flex size-9 items-center justify-center rounded-lg bg-subtle">
                  <Icon name={ENVELOPE_ICON[e.kode]} size={17} />
                </span>
                <div>
                  <p className="text-sm font-semibold">{e.nama}</p>
                  <p className="text-xs text-muted">{JENIS[e.jenis]}</p>
                </div>
              </div>
              <div>
                <label htmlFor={`def-${e.kode}`} className="label">
                  Default/minggu
                </label>
                <input id={`def-${e.kode}`} name="defaultNominal" defaultValue={e.defaultNominal} className="input-sm num" />
              </div>
              <div>
                <label htmlFor={`urut-${e.kode}`} className="label">
                  Urutan potong
                </label>
                <select id={`urut-${e.kode}`} name="urutanPotong" defaultValue={e.urutanPotong ?? ""} className="input-sm" disabled={e.kode === "makan" || e.kode === "data"}>
                  <option value="">Tidak dipotong</option>
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                </select>
              </div>
              <div>
                <label className="label flex items-center gap-2">
                  <input type="checkbox" name="terkunci" defaultChecked={e.terkunci} className="size-4 accent-[var(--brand)]" />
                  Terkunci
                </label>
                {e.terkunci && <input name="konfirmasi" placeholder="YAKIN AMBIL TABUNGAN untuk buka" className="input-sm text-xs" aria-label="Konfirmasi buka kunci" />}
              </div>
            </ActionForm>
          ))}
        </div>
      </Card>

      <Card title="Rencana pembagian per minggu" icon="calendar">
        <div className="-mx-4 overflow-x-auto sm:mx-0">
          <table className="table min-w-[640px]">
            <thead>
              <tr>
                <th>Mulai (Minggu)</th>
                {ENVELOPE_KODE.map((k) => (
                  <th key={k} className="!text-right">
                    {nama(k).split(" ")[0]}
                  </th>
                ))}
                <th className="!text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.tanggalMulai} className={period?.tanggalMulai === p.tanggalMulai ? "bg-brand-soft/60" : ""}>
                  <td className="whitespace-nowrap font-medium">{fmtTanggalPanjang(p.tanggalMulai)}</td>
                  {ENVELOPE_KODE.map((k) => (
                    <td key={k} className="num text-right">
                      {rp(p.alloc[k])}
                    </td>
                  ))}
                  <td className="num text-right font-semibold">{rp(Object.values(p.alloc).reduce((a, b) => a + b, 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-medium text-brand">Ubah atau tambah rencana</summary>
          <div className="mt-3">
            <ActionForm action={simpanRencana} submit="Simpan rencana" submitClass="btn-secondary">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
                <div className="col-span-2 sm:col-span-1">
                  <label htmlFor="tanggalMulai" className="label">
                    Minggu mulai
                  </label>
                  <input id="tanggalMulai" name="tanggalMulai" type="date" required className="input-sm" />
                </div>
                {ENVELOPE_KODE.map((k) => (
                  <div key={k}>
                    <label htmlFor={`rencana-${k}`} className="label">
                      {nama(k).split(" ")[0]}
                    </label>
                    <input id={`rencana-${k}`} name={k} placeholder="0" required className="input-sm num" />
                  </div>
                ))}
              </div>
            </ActionForm>
          </div>
        </details>
      </Card>

      {!period && <Alert tone="info">Saldo dan alokasi muncul setelah uang mingguan pertama dikonfirmasi.</Alert>}
    </div>
  );
}
