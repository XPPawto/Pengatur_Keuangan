import ActionForm from "@/components/ActionForm";
import ConfirmButton from "@/components/ConfirmButton";
import { Icon } from "@/components/icons";
import { Badge, Card, PageHeader } from "@/components/ui";
import { prisma } from "@/lib/db";
import { listBackups } from "@/lib/services/backup";
import { recentOutbox } from "@/lib/services/outbox";
import { listRecipients, type Recipient } from "@/lib/services/recipients";
import { getReminderSettings } from "@/lib/services/scheduler";
import { getAllSettings } from "@/lib/services/settings";
import { parseAturanBagi } from "@/lib/services/extra";
import { wibDate, wibHM, fmtTanggal } from "@/lib/time";
import { backupSekarang, hapusPenerima, kirimPesanTes, simpanPenerima, simpanPengingat, simpanUmum } from "../actions-lain";

export const metadata = { title: "Pengaturan" };

const STATUS_OUTBOX = { antri: "neutral", terkirim: "ok", batal: "warn", gagal: "bad" } as const;

function waktu(d: Date) {
  const { jam, menit } = wibHM(d);
  return `${fmtTanggal(wibDate(d))} ${String(jam).padStart(2, "0")}.${String(menit).padStart(2, "0")}`;
}

export default async function PengaturanPage() {
  const [penerima, pengingat, umum, outbox] = await Promise.all([listRecipients(prisma), getReminderSettings(prisma), getAllSettings(prisma), recentOutbox(prisma, 15)]);
  const backups = listBackups();

  return (
    <div className="space-y-5">
      <PageHeader title="Pengaturan" subtitle="Nomor penerima, jadwal pengingat, ekspor data, dan backup." />

      <Card title="Nomor WhatsApp" icon="users">
        <p className="mb-3 text-sm text-muted">
          <b>Pemilik</b> bisa mencatat dan menerima pengingat. <b>Keluarga</b> (mis. orang tua) hanya menerima laporan mingguan dan pemberitahuan uang diterima, dengan bahasa yang lebih sopan.
        </p>
        <ul className="divide-y divide-line">
          {penerima.map((r) => (
            <li key={r.nomor} className="py-3">
              <details>
                <summary className="flex cursor-pointer list-none items-center gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-subtle">
                    <Icon name={r.peran === "pemilik" ? "phone" : "users"} size={18} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{r.label}</span>
                    <span className="num block text-xs text-muted">+{r.nomor}</span>
                  </span>
                  <span className="flex flex-wrap justify-end gap-1">
                    <Badge tone={r.peran === "pemilik" ? "brand" : "neutral"}>{r.peran === "pemilik" ? "Pemilik" : "Keluarga"}</Badge>
                    {!r.aktif && <Badge tone="warn">Nonaktif</Badge>}
                    {r.dariEnv && <Badge tone="neutral" icon="lock">.env</Badge>}
                  </span>
                  <Icon name="chevron-down" size={16} className="shrink-0 text-muted" />
                </summary>
                <div className="mt-3 rounded-xl border border-line p-3">
                  <PenerimaForm r={r} />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <form action={kirimPesanTes}>
                      <input type="hidden" name="nomor" value={r.nomor} />
                      <button className="btn-ghost btn-sm">
                        <Icon name="send" size={15} />
                        Kirim pesan tes
                      </button>
                    </form>
                    {!r.dariEnv && (
                      <form action={hapusPenerima}>
                        <input type="hidden" name="nomor" value={r.nomor} />
                        <ConfirmButton pesan={`Hapus nomor ${r.label}?`}>
                          <Icon name="trash" size={15} />
                          Hapus
                        </ConfirmButton>
                      </form>
                    )}
                  </div>
                </div>
              </details>
            </li>
          ))}
        </ul>
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-medium text-brand">Tambah nomor</summary>
          <div className="mt-3 rounded-xl border border-line p-3">
            <PenerimaForm />
          </div>
        </details>
      </Card>

      <Card title="Pengingat terjadwal" icon="bell">
        <p className="mb-3 text-sm text-muted">Semua jam dalam WIB. Tidak ada pesan pukul 22.00–06.00 dan maksimal 1 pesan otomatis per jam per nomor (pesan yang jatuh bersamaan digabung).</p>
        <ActionForm action={simpanPengingat} submit="Simpan jadwal" submitClass="btn-secondary">
          <ul className="divide-y divide-line">
            {pengingat.map((p) => (
              <li key={p.jenis} className="flex items-center gap-3 py-2.5">
                <input type="checkbox" id={`aktif_${p.jenis}`} name={`aktif_${p.jenis}`} defaultChecked={p.aktif} className="size-4 accent-[var(--brand)]" />
                <label htmlFor={`aktif_${p.jenis}`} className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{p.label}</span>
                  <span className="block text-xs text-muted">{p.keterangan}</span>
                </label>
                <label htmlFor={`jam_${p.jenis}`} className="sr-only">
                  Jam {p.label}
                </label>
                <input id={`jam_${p.jenis}`} name={`jam_${p.jenis}`} type="time" defaultValue={p.jam} className="input-sm num w-32" />
              </li>
            ))}
          </ul>
        </ActionForm>
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card title="Umum" icon="settings">
          <ActionForm action={simpanUmum} submit="Simpan" submitClass="btn-secondary">
            <div>
              <label htmlFor="nama_pengguna" className="label">
                Nama pengguna
              </label>
              <input id="nama_pengguna" name="nama_pengguna" defaultValue={umum.nama_pengguna} className="input" />
              <p className="hint">Dipakai di sapaan dan laporan keluarga.</p>
            </div>
            <div>
              <label htmlFor="batas_tahan" className="label">
                Batas mode tahan belanja
              </label>
              <input id="batas_tahan" name="batas_tahan" defaultValue={umum.batas_tahan} className="input num" />
              <p className="hint">Pengeluaran Darurat di atas nominal ini ditawari tunda 24 jam dulu. Isi 0 untuk mematikan.</p>
            </div>
            <fieldset>
              <legend className="label">Pembagian otomatis kiriman tambahan (%)</legend>
              <div className="grid grid-cols-5 gap-2">
                {(["makan", "data", "paylater", "kado", "darurat"] as const).map((k) => (
                  <div key={k}>
                    <label htmlFor={`bagi_${k}`} className="text-[11px] capitalize text-muted">
                      {k}
                    </label>
                    <input id={`bagi_${k}`} name={`bagi_${k}`} type="number" min={0} max={100} defaultValue={parseAturanBagi(umum.bagi_ekstra)[k] ?? 0} className="input-sm num" />
                  </div>
                ))}
              </div>
              <p className="hint">Total harus 100. Dipakai untuk kiriman Ayah & uang tambahan lain (bisa dipilih manual per kiriman).</p>
            </fieldset>
            <div>
              <label htmlFor="pengirim_default" className="label">
                Pengirim default kiriman
              </label>
              <input id="pengirim_default" name="pengirim_default" defaultValue={umum.pengirim_default} className="input" />
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="otp_login" defaultChecked={umum.otp_login === "1"} className="mt-0.5 size-4 accent-[var(--brand)]" />
              <span>
                Izinkan login dengan kode WhatsApp
                <span className="block text-xs text-muted">Kode 6 digit dikirim bot ke nomor pemilik, berlaku 5 menit.</span>
              </span>
            </label>
          </ActionForm>
        </Card>

        <div className="space-y-5">
          <Card title="Ekspor data" icon="download">
            <p className="mb-3 text-sm text-muted">Excel berisi sheet Belanja Makan, Budget Mingguan, dan Ringkasan (sama dengan spreadsheet lama).</p>
            <div className="flex flex-wrap gap-2">
              <a href="/api/export/xlsx" className="btn">
                <Icon name="file" size={17} />
                Unduh Excel
              </a>
              <a href="/api/export/csv" className="btn-secondary">
                <Icon name="download" size={17} />
                Transaksi (CSV)
              </a>
            </div>
          </Card>

          <Card title="Backup database" icon="database">
            <p className="mb-3 text-sm text-muted">Otomatis tiap Sabtu 23.30, disimpan 4 salinan terakhir di folder data/backups.</p>
            <ActionForm action={backupSekarang} submit={<><Icon name="database" size={16} />Backup sekarang</>} submitClass="btn-secondary btn-sm">
              {null}
            </ActionForm>
            {backups.length > 0 && (
              <ul className="mt-3 divide-y divide-line text-sm">
                {backups.map((b) => (
                  <li key={b.nama} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0">
                      <span className="block truncate">{waktu(b.waktu)} WIB</span>
                      <span className="text-xs text-muted">{Math.round(b.ukuran / 1024)} KB</span>
                    </span>
                    <a href={`/api/backup?nama=${encodeURIComponent(b.nama)}`} className="btn-ghost btn-sm">
                      <Icon name="download" size={15} />
                      Unduh
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <Card title="Antrean pesan otomatis" icon="send">
        {outbox.length === 0 ? (
          <p className="text-sm text-muted">Belum ada pesan otomatis.</p>
        ) : (
          <div className="-mx-4 overflow-x-auto sm:mx-0">
            <table className="table min-w-[560px]">
              <thead>
                <tr>
                  <th>Waktu</th>
                  <th>Jenis</th>
                  <th>Tujuan</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {outbox.map((o) => (
                  <tr key={o.id}>
                    <td className="num whitespace-nowrap">{waktu(o.terkirimPada ?? o.dijadwalkan)}</td>
                    <td>{o.jenis.replace("_", " ")}</td>
                    <td className="num">+{o.nomor}</td>
                    <td>
                      <Badge tone={STATUS_OUTBOX[o.status as keyof typeof STATUS_OUTBOX] ?? "neutral"}>{o.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function PenerimaForm({ r }: { r?: Recipient }) {
  const id = r?.nomor ?? "baru";
  return (
    <ActionForm action={simpanPenerima} submit={r ? "Simpan" : "Tambah nomor"} submitClass="btn-secondary btn-sm" resetOnOk={!r}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor={`nomor-${id}`} className="label">
            Nomor
          </label>
          <input id={`nomor-${id}`} name="nomor" defaultValue={r?.nomor} readOnly={!!r} placeholder="08xxxxxxxxxx" required className="input-sm num" />
        </div>
        <div>
          <label htmlFor={`label-${id}`} className="label">
            Label
          </label>
          <input id={`label-${id}`} name="label" defaultValue={r?.label} placeholder="Orang tua" className="input-sm" />
        </div>
        <div>
          <label htmlFor={`peran-${id}`} className="label">
            Peran
          </label>
          <select id={`peran-${id}`} name="peran" defaultValue={r?.peran ?? "keluarga"} disabled={r?.dariEnv} className="input-sm">
            <option value="pemilik">Pemilik</option>
            <option value="keluarga">Keluarga</option>
          </select>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="terimaPengingat" defaultChecked={r?.terimaPengingat ?? false} className="size-4 accent-[var(--brand)]" />
          Pengingat harian
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="terimaLaporan" defaultChecked={r?.terimaLaporan ?? true} className="size-4 accent-[var(--brand)]" />
          Laporan mingguan
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="terimaKonfirmasiUang" defaultChecked={r?.terimaKonfirmasiUang ?? true} className="size-4 accent-[var(--brand)]" />
          Pemberitahuan uang diterima
        </label>
        {r && !r.dariEnv && (
          <label className="flex items-center gap-2">
            <input type="checkbox" name="aktif" defaultChecked={r.aktif} className="size-4 accent-[var(--brand)]" />
            Aktif
          </label>
        )}
      </div>
    </ActionForm>
  );
}
