import AsistenChat from "@/components/AsistenChat";
import { nadaStatus } from "@/components/ClaudePanel";
import ActionForm from "@/components/ActionForm";
import ProgressBar from "@/components/ProgressBar";
import { Icon } from "@/components/icons";
import Link from "next/link";
import { Alert, Badge, Card, PageHeader } from "@/components/ui";
import { prisma } from "@/lib/db";
import { getAllSettings } from "@/lib/services/settings";
import { statusAI } from "@/lib/ai/panggil";
import { pesanAIMati } from "@/lib/ai/asisten";
import { hapusKataAction, ingatAction, lupakanAction, simpanPengaturanAIAction } from "../actions-ai";

export const metadata = { title: "Asisten AI" };

const NAMA_AMPLOP: Record<string, string> = { makan: "Makan", data: "Paket data", darurat: "Darurat & kos" };
const MODEL = [
  { v: "sonnet", l: "Sonnet (seimbang)" },
  { v: "opus", l: "Opus (paling pintar, kuota lebih boros)" },
  { v: "haiku", l: "Haiku (cepat & hemat)" },
  { v: "fable", l: "Fable" },
];

export default async function AsistenPage() {
  const now = new Date();
  const [st, s, chat, memori, kata] = await Promise.all([
    statusAI(prisma, now),
    getAllSettings(prisma),
    prisma.aiChat.findMany({ where: { kanal: "web", waktu: { gte: new Date(now.getTime() - 6 * 3600_000) } }, orderBy: { id: "desc" }, take: 20 }),
    prisma.aiMemori.findMany({ orderBy: { id: "asc" } }),
    prisma.kataKategori.findMany({ orderBy: { dibuatPada: "desc" }, take: 30 }),
  ]);
  const tone = nadaStatus(st);
  const riwayat = chat.reverse().map((c) => ({ peran: c.peran === "user" ? ("user" as const) : ("asisten" as const), isi: c.isi }));
  const pakai = Math.round((st.pemakaian.hariIni / Math.max(1, st.pemakaian.batas)) * 100);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Asisten AI"
        subtitle="Ditenagai Claude lewat langganan Claude lo sendiri, bukan API berbayar. Bisa juga dipakai dari WhatsApp. Semua usulan baru jalan setelah lo setujui."
        actions={<Badge tone={tone} icon={st.kondisi === "ok" ? "check" : st.siap ? "sparkles" : "alert"}>{st.label}</Badge>}
      />

      {!st.token.ada && (
        <Alert tone="info" action={<Link href="/koneksi#claude" className="btn btn-sm shrink-0">Sambungkan</Link>}>
          Asisten belum tersambung ke akun Claude. Sambungkan sekali di halaman Koneksi pakai token <code>claude setup-token</code> dari langganan lo.
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Ngobrol" icon="bot">
          <AsistenChat riwayat={riwayat} siap={st.siap} pesanMati={st.siap ? null : pesanAIMati(st.kondisi === "belum_dicek" || st.kondisi === "ok" ? "gagal" : st.kondisi)} />
        </Card>

        <div className="space-y-5">
          <Card title="Status" icon="pulse" action={<Link href="/koneksi" className="btn-ghost btn-sm">Koneksi & pemakaian<Icon name="chevron-right" size={15} /></Link>}>
            <dl className="space-y-2.5 text-sm">
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted">Claude</dt>
                <dd>
                  <Badge tone={tone}>{st.label}</Badge>
                </dd>
              </div>
              <div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted">Pemakaian hari ini</dt>
                  <dd className="num font-medium">
                    {st.pemakaian.hariIni} / {st.pemakaian.batas}
                  </dd>
                </div>
                <div className="mt-1.5">
                  <ProgressBar persen={pakai} tone={pakai >= 100 ? "bad" : pakai >= 75 ? "warn" : "brand"} label="Pemakaian AI hari ini" />
                </div>
              </div>
            </dl>
            {st.pesan && !st.siap && <p className="mt-3 rounded-lg bg-warn-bg px-3 py-2 text-xs text-warn">{st.pesan}</p>}
          </Card>

          <Card title="Pengaturan AI" icon="settings">
            <ActionForm action={simpanPengaturanAIAction} submit="Simpan" submitClass="btn-secondary w-full">
              <Saklar nama="ai_aktif" label="Asisten AI aktif" ket="Matikan kalau mau hemat kuota Claude." on={s.ai_aktif === "1"} />
              <Saklar nama="ai_pesan_bebas" label="Jawab kalimat bebas di WhatsApp" ket="Pertanyaan & cerita yang tidak dipahami perintah biasa." on={s.ai_pesan_bebas === "1"} />
              <Saklar nama="ai_struk" label="Foto struk & bukti transfer dibaca Claude" ket="Kalau mati / gagal, pakai OCR lokal." on={s.ai_struk === "1"} />
              <Saklar nama="ai_review" label="Evaluasi & tantangan di rekap Sabtu" on={s.ai_review === "1"} />
              <Saklar nama="ai_tebak_kategori" label="Tebak amplop untuk kata baru" ket="Bot belajar dari jawaban lo." on={s.ai_tebak_kategori === "1"} />
              <div>
                <label htmlFor="ai_batas_harian" className="label">
                  Batas pemakaian per hari
                </label>
                <input id="ai_batas_harian" name="ai_batas_harian" type="number" min={1} max={500} defaultValue={s.ai_batas_harian} className="input num" />
                <p className="hint">Menjaga kuota langganan Claude lo tetap cukup buat dipakai sendiri.</p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
                <div>
                  <label htmlFor="ai_model" className="label">
                    Model utama
                  </label>
                  <select id="ai_model" name="ai_model" defaultValue={s.ai_model} className="input">
                    {MODEL.map((m) => (
                      <option key={m.v} value={m.v}>
                        {m.l}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="ai_model_ringan" className="label">
                    Model tugas kecil
                  </label>
                  <select id="ai_model_ringan" name="ai_model_ringan" defaultValue={s.ai_model_ringan} className="input">
                    {MODEL.map((m) => (
                      <option key={m.v} value={m.v}>
                        {m.l}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </ActionForm>
          </Card>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card title="Memori asisten" icon="brain">
          <p className="mb-3 text-sm text-muted">Hal yang selalu diingat asisten saat ngasih saran. Bisa ditambah dari WhatsApp: <code>ingat kado buat adik</code>.</p>
          {memori.length ? (
            <ul className="mb-3 divide-y divide-line">
              {memori.map((m) => (
                <li key={m.id} className="flex items-start gap-2 py-2">
                  <span className="num w-6 shrink-0 pt-0.5 text-xs text-muted">{m.id}.</span>
                  <p className="min-w-0 flex-1 text-sm">{m.isi}</p>
                  <Badge tone={m.sumber === "asisten" ? "brand" : "neutral"}>{m.sumber === "asisten" ? "dari AI" : "lo"}</Badge>
                  <form action={lupakanAction}>
                    <input type="hidden" name="id" value={m.id} />
                    <button className="btn-ghost btn-sm !px-2" aria-label={`Lupakan: ${m.isi}`}>
                      <Icon name="trash" size={15} />
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-3 rounded-xl bg-subtle px-3 py-2 text-sm text-muted">Belum ada memori.</p>
          )}
          <ActionForm action={ingatAction} submit="Ingat" submitClass="btn-secondary btn-sm" resetOnOk className="flex flex-wrap items-start gap-2 [&>div[role]]:basis-full">
            <label htmlFor="isi-memori" className="sr-only">
              Memori baru
            </label>
            <input id="isi-memori" name="isi" required maxLength={200} placeholder="mis. kado buat adik, ultahnya 20 Nov" className="input-sm min-w-0 flex-1" />
          </ActionForm>
        </Card>

        <Card title="Kata yang dipelajari" icon="sparkles">
          <p className="mb-3 text-sm text-muted">Barang yang tadinya nggak dikenal bot. Sekarang langsung masuk amplop yang benar tanpa tanya.</p>
          {kata.length ? (
            <ul className="flex flex-wrap gap-2">
              {kata.map((k) => (
                <li key={k.kata} className="flex items-center gap-1 rounded-full border border-line py-0.5 pl-3 pr-1 text-sm">
                  <span>{k.kata}</span>
                  <span className="text-xs text-muted">→ {NAMA_AMPLOP[k.envelopeKode] ?? k.envelopeKode}</span>
                  <form action={hapusKataAction}>
                    <input type="hidden" name="kata" value={k.kata} />
                    <button className="flex size-6 items-center justify-center rounded-full text-muted hover:bg-subtle" aria-label={`Hapus kata ${k.kata}`}>
                      <Icon name="x" size={13} />
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-xl bg-subtle px-3 py-2 text-sm text-muted">Belum ada. Bot belajar tiap kali lo milih amplop untuk barang baru.</p>
          )}
        </Card>
      </div>
    </div>
  );
}

function Saklar({ nama, label, ket, on }: { nama: string; label: string; ket?: string; on: boolean }) {
  return (
    <label htmlFor={nama} className="flex cursor-pointer items-start gap-3">
      <input type="checkbox" id={nama} name={nama} defaultChecked={on} className="mt-0.5 size-4 shrink-0 accent-[var(--brand)]" />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {ket && <span className="block text-xs text-muted">{ket}</span>}
      </span>
    </label>
  );
}
