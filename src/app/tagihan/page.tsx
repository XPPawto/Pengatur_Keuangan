import ActionForm from "@/components/ActionForm";
import ConfirmButton from "@/components/ConfirmButton";
import { Icon } from "@/components/icons";
import { Badge, Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import { prisma } from "@/lib/db";
import type { Tone } from "@/lib/format";
import { rp } from "@/lib/money";
import { billsWithReadiness } from "@/lib/services/bills";
import { listEnvelopes } from "@/lib/services/envelopes";
import { fmtTanggalPanjang, wibDate } from "@/lib/time";
import { batalLunas, bayarTagihan, hapusTagihan, simpanTagihan } from "../actions-keuangan";

export const metadata = { title: "Tagihan" };

type Bill = Awaited<ReturnType<typeof billsWithReadiness>>[number];

export default async function TagihanPage() {
  const now = new Date();
  const [bills, envs] = await Promise.all([billsWithReadiness(prisma, now), listEnvelopes(prisma)]);
  const belum = bills.filter((b) => b.status === "belum");
  const lunas = bills.filter((b) => b.status === "lunas").sort((a, b) => b.jatuhTempo.localeCompare(a.jatuhTempo));
  const totalBelum = belum.reduce((s, b) => s + b.nominal, 0);
  const telat = belum.filter((b) => b.hariLagi < 0).length;

  const fields = (b?: Bill) => (
    <>
      {b && <input type="hidden" name="id" value={b.id} />}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`nama-${b?.id ?? "baru"}`} className="label">
            Nama tagihan
          </label>
          <input id={`nama-${b?.id ?? "baru"}`} name="nama" defaultValue={b?.nama ?? "Paylater"} required className="input" />
        </div>
        <div>
          <label htmlFor={`nom-${b?.id ?? "baru"}`} className="label">
            Nominal
          </label>
          <input id={`nom-${b?.id ?? "baru"}`} name="nominal" defaultValue={b?.nominal} placeholder="80k" required className="input num" />
        </div>
        <div>
          <label htmlFor={`jt-${b?.id ?? "baru"}`} className="label">
            Jatuh tempo
          </label>
          <input id={`jt-${b?.id ?? "baru"}`} name="jatuhTempo" type="date" defaultValue={b?.jatuhTempo ?? wibDate(now)} required className="input" />
        </div>
        <div>
          <label htmlFor={`env-${b?.id ?? "baru"}`} className="label">
            Amplop sumber dana
          </label>
          <select id={`env-${b?.id ?? "baru"}`} name="envelopeKode" defaultValue={b?.envelope?.kode ?? "paylater"} className="input">
            <option value="">Di luar amplop</option>
            {envs.map((e) => (
              <option key={e.kode} value={e.kode}>
                {e.nama}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label htmlFor={`cat-${b?.id ?? "baru"}`} className="label">
          Catatan
        </label>
        <input id={`cat-${b?.id ?? "baru"}`} name="catatan" defaultValue={b?.catatan} className="input" />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="tanggalPasti" defaultChecked={b?.tanggalPasti ?? true} className="size-4 accent-[var(--brand)]" />
        Tanggal sudah pasti
      </label>
    </>
  );

  return (
    <div className="space-y-5">
      <PageHeader title="Tagihan" subtitle="Paylater dan tagihan lain. Bot mengingatkan H-3 dan H-1 pukul 09.00." />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat icon="calendar" label="Belum lunas" value={rp(totalBelum)} hint={`${belum.length} tagihan`} />
        <Stat icon="alert" label="Terlambat" value={String(telat)} tone={telat ? "bad" : undefined} hint={telat ? "tandai lunas kalau sudah dibayar" : "semua aman"} />
        <Stat icon="check-circle" label="Sudah lunas" value={String(lunas.length)} />
      </div>

      <Card title="Belum lunas" icon="clock">
        {belum.length === 0 ? (
          <EmptyState icon="check-circle" title="Tidak ada tagihan tertunda" />
        ) : (
          <ul className="divide-y divide-line">
            {belum.map((b) => {
              const tone: Tone = b.hariLagi < 0 ? "bad" : b.hariLagi <= 3 ? "warn" : "ok";
              return (
                <li key={b.id} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="num font-semibold">
                        {b.nama} · {rp(b.nominal)}
                      </p>
                      <p className="text-sm text-muted">
                        {fmtTanggalPanjang(b.jatuhTempo)}
                        {!b.tanggalPasti && " · tanggal perkiraan"} · {b.envelope ? `dari ${b.envelope.nama}` : "di luar amplop"}
                      </p>
                      {b.catatan && <p className="mt-0.5 text-xs text-muted">{b.catatan}</p>}
                    </div>
                    <Badge tone={tone} icon={tone === "ok" ? "clock" : "alert"}>
                      {b.hariLagi < 0 ? `Lewat ${-b.hariLagi} hari` : b.hariLagi === 0 ? "Hari ini" : `H-${b.hariLagi}`}
                    </Badge>
                  </div>
                  {b.cukup !== null && (
                    <p className={`mt-2 text-sm ${b.cukup ? "text-ok" : "text-warn"}`}>
                      Saldo {b.envelope?.nama} {rp(b.saldoSumber ?? 0)} — {b.cukup ? "cukup" : `kurang ${rp(b.nominal - (b.saldoSumber ?? 0))}`}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap items-start gap-2">
                    <ActionForm action={bayarTagihan} submit={<><Icon name="check" size={16} />Tandai lunas</>} submitClass="btn btn-sm" className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="id" value={b.id} />
                      <label htmlFor={`bayar-${b.id}`} className="sr-only">
                        Nominal dibayar
                      </label>
                      <input id={`bayar-${b.id}`} name="nominal" placeholder={`${b.nominal}`} className="input-sm num w-28" />
                    </ActionForm>
                    <details className="w-full">
                      <summary className="btn-secondary btn-sm cursor-pointer list-none">
                        <Icon name="pencil" size={15} />
                        Ubah
                      </summary>
                      <div className="mt-3 w-full max-w-xl rounded-xl border border-line p-3">
                        <ActionForm action={simpanTagihan} submit="Simpan perubahan" submitClass="btn-secondary btn-sm">
                          {fields(b)}
                        </ActionForm>
                        <form action={hapusTagihan} className="mt-2">
                          <input type="hidden" name="id" value={b.id} />
                          <ConfirmButton pesan={`Hapus tagihan ${b.nama} ${rp(b.nominal)}?`}>
                            <Icon name="trash" size={15} />
                            Hapus tagihan
                          </ConfirmButton>
                        </form>
                      </div>
                    </details>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card title="Tambah tagihan" icon="plus-circle">
        <ActionForm action={simpanTagihan} submit="Tambah tagihan" resetOnOk>
          {fields()}
        </ActionForm>
      </Card>

      {lunas.length > 0 && (
        <Card title="Riwayat lunas" icon="check-circle">
          <ul className="divide-y divide-line text-sm">
            {lunas.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 py-2.5">
                <span className="min-w-0">
                  <span className="num font-medium">
                    {b.nama} {rp(b.nominal)}
                  </span>
                  <span className="block text-xs text-muted">
                    Jatuh tempo {fmtTanggalPanjang(b.jatuhTempo)}
                    {b.dibayarPada && ` · dibayar ${fmtTanggalPanjang(wibDate(b.dibayarPada))}`}
                  </span>
                </span>
                <form action={batalLunas}>
                  <input type="hidden" name="id" value={b.id} />
                  <button className="btn-ghost btn-sm text-xs">Batalkan lunas</button>
                </form>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
