import ActionForm from "@/components/ActionForm";
import { Icon } from "@/components/icons";
import { Badge, Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import { prisma } from "@/lib/db";
import { rp } from "@/lib/money";
import { listDebts } from "@/lib/services/debts";
import { fmtTanggalPanjang, wibDate } from "@/lib/time";
import { bayarHutang, patunganAction, tambahHutang } from "../actions-plus";

export const metadata = { title: "Hutang-piutang" };

export default async function HutangPage() {
  const now = new Date();
  const rows = await listDebts(prisma, now);
  const aktif = rows.filter((r) => r.status === "aktif");
  const piutang = aktif.filter((r) => r.arah === "piutang");
  const hutang = aktif.filter((r) => r.arah === "hutang");
  const lunas = rows.filter((r) => r.status === "lunas").slice(0, 20);

  const Daftar = ({ list, arah }: { list: typeof aktif; arah: "piutang" | "hutang" }) =>
    list.length === 0 ? (
      <p className="text-sm text-muted">{arah === "piutang" ? "Tidak ada yang utang ke lo." : "Lo tidak punya utang."}</p>
    ) : (
      <ul className="divide-y divide-line">
        {list.map((d) => (
          <li key={d.id} className="py-3 first:pt-0 last:pb-0">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold">{d.orang}</p>
                <p className="text-xs text-muted">
                  {d.catatan || (arah === "piutang" ? "Pinjaman" : "Utang")} · {fmtTanggalPanjang(wibDate(d.dibuatPada))} · {d.umurHari} hari
                </p>
              </div>
              <div className="text-right">
                <p className="num font-semibold">{rp(d.sisa)}</p>
                {d.sisa !== d.nominal && <p className="num text-xs text-muted">dari {rp(d.nominal)}</p>}
                {arah === "piutang" && d.umurHari >= 14 && <Badge tone="warn">Lama</Badge>}
              </div>
            </div>
            <ActionForm action={bayarHutang} submit={arah === "piutang" ? "Dibayar" : "Bayar"} submitClass="btn-secondary btn-sm" className="mt-2 flex flex-wrap items-center gap-2">
              <input type="hidden" name="orang" value={d.orang} />
              <input type="hidden" name="arah" value={arah} />
              <label htmlFor={`b-${d.id}`} className="sr-only">
                Nominal
              </label>
              <input id={`b-${d.id}`} name="nominal" placeholder={`${d.sisa} (kosong = lunas)`} className="input-sm num w-44" />
            </ActionForm>
          </li>
        ))}
      </ul>
    );

  return (
    <div className="space-y-5">
      <PageHeader title="Hutang-piutang" subtitle="Uang yang dipinjamkan ikut keluar dari amplop, dan kembali ke amplop saat dibayar — jadi saldo selalu cocok dengan dompet." />
      <div className="grid grid-cols-2 gap-3">
        <Stat icon="hand-coins" label="Uang lo di orang lain" value={rp(piutang.reduce((a, d) => a + d.sisa, 0))} hint={`${piutang.length} orang`} />
        <Stat icon="card" label="Utang lo" value={rp(hutang.reduce((a, d) => a + d.sisa, 0))} hint={`${hutang.length} orang`} tone={hutang.length ? "warn" : undefined} />
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card title="Mereka utang ke lo" icon="hand-coins">
          <Daftar list={piutang} arah="piutang" />
        </Card>
        <Card title="Lo utang ke mereka" icon="card">
          <Daftar list={hutang} arah="hutang" />
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card title="Catat baru" icon="plus-circle">
          <ActionForm action={tambahHutang} submit="Catat" resetOnOk>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label htmlFor="arah" className="label">
                  Jenis
                </label>
                <select id="arah" name="arah" className="input">
                  <option value="piutang">Teman pinjam ke gw (uang keluar)</option>
                  <option value="hutang">Gw pinjam ke teman (uang masuk)</option>
                </select>
              </div>
              <div>
                <label htmlFor="orang" className="label">
                  Nama
                </label>
                <input id="orang" name="orang" required placeholder="Budi" className="input" />
              </div>
              <div>
                <label htmlFor="nominal" className="label">
                  Nominal
                </label>
                <input id="nominal" name="nominal" required placeholder="20k" className="input num" />
              </div>
              <div className="col-span-2">
                <label htmlFor="catatan" className="label">
                  Catatan
                </label>
                <input id="catatan" name="catatan" placeholder="buat beli pulsa" className="input" />
              </div>
            </div>
          </ActionForm>
        </Card>
        <Card title="Patungan" icon="users">
          <p className="mb-3 text-sm text-muted">Lo bayar duluan, dibagi rata. Bagian lo dicatat sebagai pengeluaran, bagian teman jadi piutang.</p>
          <ActionForm action={patunganAction} submit="Bagi rata" resetOnOk>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="barang" className="label">
                  Untuk
                </label>
                <input id="barang" name="barang" required placeholder="galon" className="input" />
              </div>
              <div>
                <label htmlFor="total" className="label">
                  Total
                </label>
                <input id="total" name="nominal" required placeholder="18k" className="input num" />
              </div>
              <div className="col-span-2">
                <label htmlFor="teman" className="label">
                  Teman (pisah koma)
                </label>
                <input id="teman" name="orang" required placeholder="budi, andi" className="input" />
              </div>
            </div>
          </ActionForm>
        </Card>
      </div>

      <Card title="Sudah lunas" icon="check-circle">
        {lunas.length === 0 ? (
          <EmptyState icon="hand-coins" title="Belum ada yang lunas" />
        ) : (
          <ul className="divide-y divide-line text-sm">
            {lunas.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                <span>
                  {d.arah === "piutang" ? `${d.orang} → lo` : `Lo → ${d.orang}`} <span className="text-muted">{d.catatan}</span>
                </span>
                <span className="num">{rp(d.nominal)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <p className="flex items-center justify-center gap-1.5 text-xs text-muted">
        <Icon name="message" size={14} /> Di WhatsApp: <code>pinjemin budi 20k</code> · <code>budi bayar 10k</code> · <code>patungan galon 18k sama budi andi</code>
      </p>
    </div>
  );
}
