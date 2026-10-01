import ActionForm from "@/components/ActionForm";
import ConfirmButton from "@/components/ConfirmButton";
import ProgressBar from "@/components/ProgressBar";
import { Icon } from "@/components/icons";
import { Badge, Card, PageHeader, Stat } from "@/components/ui";
import { prisma } from "@/lib/db";
import { rp } from "@/lib/money";
import { getShoppingWeek } from "@/lib/services/shopping";
import { hargaAsli } from "@/lib/services/prices";
import { pakaiHargaAsli } from "../actions-plus";
import { HARI, fmtTanggalPanjang } from "@/lib/time";
import { centangBelanja, hapusItemBelanja, simpanItemBelanja, simpanMenu } from "../actions-lain";

export const metadata = { title: "Belanja mingguan" };

export default async function BelanjaPage() {
  const w = await getShoppingWeek(prisma, new Date());
  const lauk = await prisma.laukRotasi.findMany({ orderBy: { mingguKe: "asc" } });
  const harga = (await hargaAsli(prisma, new Date())).filter((h) => Math.abs(h.median - h.rencana) >= 1000);
  const aktif = w.items.filter((i) => i.aktif);
  const urutHari = [0, 1, 2, 3, 4, 5, 6];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Belanja mingguan"
        subtitle={`Minggu mulai ${fmtTanggalPanjang(w.mingguMulai)} · tanpa sayur, lauk rotasi minggu ke-${w.laukKe}`}
        actions={
          <Badge tone={w.status === "aman" ? "ok" : "bad"} icon={w.status === "aman" ? "check" : "alert"}>
            {w.status === "aman" ? "Aman dalam budget" : "Lewat budget"}
          </Badge>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat icon="cart" label="Total daftar" value={rp(w.total)} hint={`budget ${rp(w.budget)}`} tone={w.status === "lewat" ? "bad" : undefined} />
        <Stat icon="wallet" label={w.selisih >= 0 ? "Sisa budget" : "Kelebihan"} value={rp(Math.abs(w.selisih))} tone={w.selisih < 0 ? "bad" : undefined} />
        <Stat icon="check-circle" label="Sudah dibeli" value={rp(w.sudahDibeli)} hint={`${aktif.filter((i) => i.dibeli).length}/${aktif.length} item`} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        <Card title="Daftar belanja" icon="cart" className="lg:col-span-3">
          <div className="mb-3">
            <ProgressBar persen={w.total ? (w.sudahDibeli / w.total) * 100 : 0} tone="brand" label="Progres belanja" />
          </div>
          <ul className="divide-y divide-line">
            {w.items.map((i) => (
              <li key={i.id} className={`py-2.5 ${i.aktif ? "" : "opacity-50"}`}>
                <div className="flex items-center gap-3">
                  <form action={centangBelanja}>
                    <input type="hidden" name="minggu" value={w.mingguMulai} />
                    <input type="hidden" name="itemId" value={i.id} />
                    <input type="hidden" name="dibeli" value={i.dibeli ? "0" : "1"} />
                    <button
                      aria-label={i.dibeli ? `Batalkan centang ${i.nama}` : `Centang ${i.nama}`}
                      aria-pressed={i.dibeli}
                      className={`flex size-6 items-center justify-center rounded-md border-2 transition ${i.dibeli ? "border-brand bg-brand text-brand-fg" : "border-line-strong"}`}
                    >
                      {i.dibeli && <Icon name="check" size={14} strokeWidth={3} />}
                    </button>
                  </form>
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-sm font-medium ${i.dibeli ? "text-muted line-through" : ""}`}>{i.nama}</p>
                    <p className="num text-xs text-muted">
                      {i.jumlah} {i.satuan} × {rp(i.hargaSatuan)}
                    </p>
                  </div>
                  <span className="num text-sm font-semibold">{rp(i.subtotal)}</span>
                  <details className="relative">
                    <summary className="btn-ghost btn-sm cursor-pointer list-none !px-2" aria-label={`Ubah ${i.nama}`}>
                      <Icon name="pencil" size={15} />
                    </summary>
                    <div className="absolute right-0 z-10 mt-2 w-[300px] rounded-xl border border-line bg-card p-3 shadow-lg">
                      <ActionForm action={simpanItemBelanja} submit="Simpan" submitClass="btn btn-sm">
                        <input type="hidden" name="id" value={i.id} />
                        <ItemFields item={i} />
                        <label className="flex items-center gap-2 text-sm">
                          <input type="checkbox" name="aktif" defaultChecked={i.aktif} className="size-4 accent-[var(--brand)]" />
                          Masuk daftar minggu ini
                        </label>
                      </ActionForm>
                      <form action={hapusItemBelanja} className="mt-2">
                        <input type="hidden" name="id" value={i.id} />
                        <ConfirmButton pesan={`Hapus ${i.nama}?`}>
                          <Icon name="trash" size={15} />
                          Hapus item
                        </ConfirmButton>
                      </form>
                    </div>
                  </details>
                </div>
              </li>
            ))}
          </ul>
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-medium text-brand">Tambah item</summary>
            <div className="mt-3">
              <ActionForm action={simpanItemBelanja} submit="Tambah" submitClass="btn-secondary btn-sm" resetOnOk>
                <ItemFields />
              </ActionForm>
            </div>
          </details>
        </Card>

        <div className="space-y-5 lg:col-span-2">
          <Card title="Lauk rotasi 4 minggu" icon="refresh">
            <ul className="space-y-2">
              {lauk.map((l) => (
                <li key={l.mingguKe} className={`flex items-center justify-between rounded-xl px-3 py-2.5 text-sm ${l.mingguKe === w.laukKe ? "bg-brand-soft text-brand" : "bg-subtle"}`}>
                  <span>
                    <span className="font-semibold">Minggu {l.mingguKe}</span> · {l.nama} ({l.jumlah})
                  </span>
                  <span className="num text-xs">±{rp(l.estimasi)}</span>
                </li>
              ))}
            </ul>
          </Card>
          {harga.length > 0 && (
            <Card title="Harga asli vs rencana" icon="trending-up">
              <p className="mb-2 text-xs text-muted">Dari catatan belanja 60 hari terakhir.</p>
              <ul className="divide-y divide-line">
                {harga.map((h) => (
                  <li key={h.itemId} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{h.nama}</span>
                      <span className="num text-xs text-muted">
                        rencana {rp(h.rencana)} · biasanya {rp(h.median)} ({h.jumlahData}×)
                      </span>
                    </span>
                    <form action={pakaiHargaAsli}>
                      <input type="hidden" name="itemId" value={h.itemId} />
                      <input type="hidden" name="harga" value={h.saranHargaSatuan} />
                      <button className="btn-secondary btn-sm">Pakai</button>
                    </form>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card title="Menu hari ini" icon="utensils">
            <ul className="space-y-1.5 text-sm">
              {w.menu
                .filter((m) => m.hari === w.hariIni)
                .map((m) => (
                  <li key={m.id} className="flex gap-3">
                    <span className="w-14 shrink-0 capitalize text-muted">{m.waktu}</span>
                    <span className="font-medium">{m.menu}</span>
                  </li>
                ))}
            </ul>
          </Card>
        </div>
      </div>

      <Card title="Contoh menu 7 hari (tanpa sayur)" icon="calendar">
        <ActionForm action={simpanMenu} submit="Simpan menu & lauk" submitClass="btn-secondary">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {urutHari.map((h) => (
              <fieldset key={h} className={`rounded-xl border p-3 ${h === w.hariIni ? "border-brand" : "border-line"}`}>
                <legend className="px-1 text-sm font-semibold">
                  {HARI[h]}
                  {h === w.hariIni && <span className="ml-1 text-xs font-medium text-brand">hari ini</span>}
                </legend>
                {w.menu
                  .filter((m) => m.hari === h)
                  .map((m) => (
                    <div key={m.id} className="mb-1.5">
                      <label htmlFor={`menu_${m.id}`} className="text-[11px] capitalize text-muted">
                        {m.waktu}
                      </label>
                      <input id={`menu_${m.id}`} name={`menu_${m.id}`} defaultValue={m.menu} className="input-sm" />
                    </div>
                  ))}
              </fieldset>
            ))}
          </div>
          <details>
            <summary className="cursor-pointer text-sm font-medium text-brand">Ubah lauk rotasi</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {lauk.map((l) => (
                <div key={l.mingguKe} className="grid grid-cols-[1fr_90px_90px] gap-2">
                  <input name={`lauk_${l.mingguKe}_nama`} defaultValue={l.nama} className="input-sm" aria-label={`Lauk minggu ${l.mingguKe}`} />
                  <input name={`lauk_${l.mingguKe}_jumlah`} defaultValue={l.jumlah} className="input-sm" aria-label="Jumlah" />
                  <input name={`lauk_${l.mingguKe}_estimasi`} defaultValue={l.estimasi} className="input-sm num" aria-label="Estimasi harga" />
                </div>
              ))}
            </div>
          </details>
        </ActionForm>
      </Card>
    </div>
  );
}

function ItemFields({ item }: { item?: { id: number; nama: string; jumlah: number; satuan: string; hargaSatuan: number; kataKunci: string } }) {
  const id = item?.id ?? "baru";
  let kw = "";
  try {
    kw = (JSON.parse(item?.kataKunci ?? "[]") as string[]).join(", ");
  } catch {
    /* kosong */
  }
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="col-span-2">
        <label htmlFor={`in-${id}`} className="label">
          Nama
        </label>
        <input id={`in-${id}`} name="nama" defaultValue={item?.nama} required className="input-sm" />
      </div>
      <div>
        <label htmlFor={`ij-${id}`} className="label">
          Jumlah
        </label>
        <input id={`ij-${id}`} name="jumlah" defaultValue={item?.jumlah ?? 1} required className="input-sm num" />
      </div>
      <div>
        <label htmlFor={`is-${id}`} className="label">
          Satuan
        </label>
        <input id={`is-${id}`} name="satuan" defaultValue={item?.satuan ?? "bungkus"} required className="input-sm" />
      </div>
      <div className="col-span-2">
        <label htmlFor={`ih-${id}`} className="label">
          Harga per satuan
        </label>
        <input id={`ih-${id}`} name="hargaSatuan" defaultValue={item?.hargaSatuan} placeholder="5k" required className="input-sm num" />
      </div>
      <div className="col-span-2">
        <label htmlFor={`ik-${id}`} className="label">
          Kata kunci bot (pisah koma)
        </label>
        <input id={`ik-${id}`} name="kataKunci" defaultValue={kw} placeholder="tempe, tempeh" className="input-sm" />
      </div>
    </div>
  );
}
