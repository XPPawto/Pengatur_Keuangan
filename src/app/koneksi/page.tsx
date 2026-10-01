import ClaudePanel, { nadaStatus } from "@/components/ClaudePanel";
import PetaKoneksi from "@/components/PetaKoneksi";
import WaPanel from "@/components/WaPanel";
import StackedColumns from "@/components/charts/StackedColumns";
import { Alert, Badge, Card, PageHeader, Stat } from "@/components/ui";
import { prisma } from "@/lib/db";
import { kunciCadangan, LABEL_FITUR, LABEL_KONDISI, statusAI } from "@/lib/ai/panggil";
import { daftarModelGeminiCache, segarkanDaftarGemini } from "@/lib/ai/gemini";
import { bacaStatistik } from "@/lib/ai/modelOtomatis";
import type { BarisStatModel } from "@/lib/ai/model";
import { dataKoneksi, ringkasanPemakaian } from "@/lib/services/koneksi";
import { getAllSettings, getSetting } from "@/lib/services/settings";
import CadanganPanel from "@/components/CadanganPanel";
import { daftarModelGratis } from "@/lib/ai/openrouter";
import { fmtTanggal, wibDate, wibHM } from "@/lib/time";

export const metadata = { title: "Koneksi" };

const WARNA_FITUR: Record<string, string> = {
  chat_web: "var(--series-1)",
  chat_wa: "var(--series-2)",
  struk: "var(--series-3)",
  review: "var(--series-4)",
  kategori: "var(--series-5)",
  cek: "var(--muted)",
};

const angka = (n: number) => new Intl.NumberFormat("id-ID", { notation: n >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(n);

function jamMenit(d: Date) {
  const { jam, menit } = wibHM(d);
  return `${String(jam).padStart(2, "0")}.${String(menit).padStart(2, "0")}`;
}

export default async function KoneksiPage() {
  const now = new Date();
  const [peta, st, model, u, setel, modelGratis] = await Promise.all([
    dataKoneksi(prisma, now),
    statusAI(prisma, now),
    getSetting(prisma, "ai_model"),
    ringkasanPemakaian(prisma, now),
    getAllSettings(prisma),
    daftarModelGratis().catch(() => null),
  ]);

  // kesehatan model (statistik belajar otomatis); status dihitung di sini supaya server & browser tidak beda jam
  const stat = await bacaStatistik(prisma);
  const labelWaktu = (iso: string) => {
    const d = new Date(iso);
    const { jam, menit } = wibHM(d);
    const hm = `${String(jam).padStart(2, "0")}.${String(menit).padStart(2, "0")}`;
    return wibDate(d) === wibDate(now) ? hm : `${fmtTanggal(wibDate(d))} ${hm}`;
  };
  const statModel: BarisStatModel[] = Object.entries(stat)
    .map(([k, v]) => {
      const [penyedia, ...sisa] = k.split("|");
      const ditahan = !!v.tahanSampai && new Date(v.tahanSampai) > now;
      return {
        penyedia,
        model: sisa.join("|"),
        ok: v.ok,
        gagal: v.gagal,
        ms: v.ms,
        status: ditahan ? (v.jenis === "rusak" ? "ditutup" : "ditahan") : v.berturut > 0 ? "sempat_gagal" : "sehat",
        bolehLagi: ditahan ? labelWaktu(v.tahanSampai!) : null,
      } satisfies BarisStatModel;
    })
    .sort((a, b) => a.penyedia.localeCompare(b.penyedia) || b.ok - a.ok || a.model.localeCompare(b.model));
  // daftar model Gemini dari Google: dibaca dari cache, dimuat di latar belakang kalau belum ada (tidak menunda halaman)
  const keyGemini = (await kunciCadangan(prisma, "gemini")).kunci;
  const geminiDitemukan = daftarModelGeminiCache();
  if (!geminiDitemukan && keyGemini) segarkanDaftarGemini(keyGemini);

  const waOk = peta.wa.status === "terhubung" && peta.wa.botHidup;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Koneksi"
        subtitle="Semua yang tersambung ke DompetKos: bot WhatsApp dan asisten AI Claude. Diperbarui otomatis."
        actions={
          <>
            <Badge tone={waOk ? "ok" : peta.wa.status === "menunggu_pairing" ? "warn" : "bad"} icon="message">
              WhatsApp {waOk ? "terhubung" : !peta.wa.botHidup ? "bot mati" : peta.wa.status === "menunggu_pairing" ? "menunggu" : "terputus"}
            </Badge>
            <Badge tone={nadaStatus(st)} icon="bot">
              Claude: {st.label}
            </Badge>
          </>
        }
      />

      <Card className="!p-3 sm:!p-4">
        <PetaKoneksi awal={peta} />
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <section id="whatsapp" className="scroll-mt-20 space-y-3">
          <h2 className="section-title">WhatsApp</h2>
          <Alert tone="warn">Library WhatsApp tidak resmi: nomor bot bisa diblokir kapan saja. Jangan pakai nomor utama atau nomor penerima.</Alert>
          <WaPanel />
        </section>
        <section id="claude" className="scroll-mt-20 space-y-3">
          <h2 className="section-title">Claude (asisten AI)</h2>
          <Card>
            <ClaudePanel st={st} model={model} />
          </Card>
          <p className="text-xs text-muted">
            Bot menjalankan <code>claude -p</code> dengan token langganan lo, tanpa API key, jadi tidak ada tagihan per token. Batas langganan (sesi 5 jam & mingguan) dipakai bersama claude.ai; angkanya dibaca dari respons Claude setiap kali bot memanggil, angka paling baru selalu ada di claude.ai → Settings → Usage. Kalau kena batas, AI istirahat sampai jam reset; kalau sesi 5 jam ≥90%, tugas kecil (tebak kategori, review) dihemat. Atur fitur & batas harian bot di halaman Asisten.
          </p>
        </section>
      </div>

      <section id="cadangan" className="scroll-mt-20 space-y-3">
        <h2 className="section-title">AI cadangan (kalau Claude nggak bisa dipakai)</h2>
        <p className="text-sm text-muted">
          Kalau Claude kena batas, tokennya ditolak, atau lagi error, asisten otomatis pindah ke cadangan sesuai urutan. Balasannya diberi tanda &quot;lewat Gemini/OpenRouter&quot;. Semua tetap gratis.
        </p>
        <CadanganPanel
          cadangan={st.cadangan}
          claudeAktif={setel.ai_claude_aktif === "1"}
          urutan={setel.ai_urutan_cadangan}
          modelGemini={setel.ai_gemini_model}
          modelGeminiRingan={setel.ai_gemini_model_ringan}
          modelOpenRouter={setel.ai_openrouter_model}
          modelGratis={modelGratis}
          autoGemini={setel.ai_gemini_auto !== "0"}
          autoOpenRouter={setel.ai_openrouter_auto !== "0"}
          statModel={statModel}
          geminiDitemukan={geminiDitemukan}
        />
      </section>

      <section id="pemakaian" className="scroll-mt-20 space-y-3">
        <h2 className="section-title">Pemakaian AI</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {(["five_hour", "seven_day"] as const).map((k) => {
            const j = st.langganan.find((x) => x.kode === k);
            return (
              <Stat
                key={k}
                icon={k === "five_hour" ? "clock" : "calendar"}
                label={k === "five_hour" ? "Sesi 5 jam (langganan)" : "Mingguan (langganan)"}
                value={j ? `${Math.round(j.persen)}%` : "–"}
                hint={!j ? "muncul setelah bot memanggil Claude" : j.sudahReset ? "sudah reset" : j.reset ? `reset ${j.reset}` : "terpakai"}
                tone={j && j.persen >= 90 ? "bad" : j && j.persen >= 70 ? "warn" : undefined}
              />
            );
          })}
          <Stat icon="bot" label="Panggilan bot hari ini" value={`${u.hariIni.panggilan}/${st.pemakaian.batas}`} hint={u.hariIni.gagal ? `${u.hariIni.gagal} gagal` : "semua berhasil"} tone={u.hariIni.panggilan >= st.pemakaian.batas ? "bad" : undefined} />
          <Stat icon="file" label="Token hari ini" value={angka(u.hariIni.tokenMasuk + u.hariIni.tokenKeluar)} hint={`${angka(u.hariIni.tokenMasuk)} masuk · ${angka(u.hariIni.tokenKeluar)} keluar`} />
          <Stat icon="clock" label="Waktu jawab" value={u.tujuhHari.rataDetik === null ? "–" : `${u.tujuhHari.rataDetik.toFixed(1)} dtk`} hint="rata-rata 7 hari" />
          <Stat
            icon="check-circle"
            label="Tingkat berhasil"
            value={u.tujuhHari.tingkatBerhasil === null ? "–" : `${Math.round(u.tujuhHari.tingkatBerhasil * 100)}%`}
            hint={`${u.tujuhHari.panggilan} panggilan · 7 hari`}
            tone={u.tujuhHari.tingkatBerhasil !== null && u.tujuhHari.tingkatBerhasil < 0.8 ? "warn" : undefined}
          />
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Card title={`Panggilan per hari (${fmtTanggal(u.tanggal[0])} – ${fmtTanggal(u.tanggal[u.tanggal.length - 1])})`} icon="chart">
            <StackedColumns
              title="Panggilan Claude per hari per fitur"
              labels={u.tanggal.map((t) => String(Number(t.slice(8))))}
              series={u.fiturList.map((f) => ({ key: f, label: LABEL_FITUR[f], color: WARNA_FITUR[f] }))}
              data={u.perHari}
              height={220}
              satuan="kali"
            />
          </Card>
          <Card title="Per fitur (7 hari)" icon="grid">
            {u.perFitur.length ? (
              <ul className="divide-y divide-line">
                {u.perFitur.map((f) => (
                  <li key={f.kode} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                    <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                      <span className="size-2.5 shrink-0 rounded-sm" style={{ background: WARNA_FITUR[f.kode] }} />
                      <span className="truncate">{f.label}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="num block text-sm font-semibold">
                        {f.berhasil}/{f.panggilan} berhasil
                      </span>
                      <span className="num block text-xs text-muted">
                        {angka(f.tokenMasuk + f.tokenKeluar)} token{f.rataDetik === null ? "" : ` · ${f.rataDetik.toFixed(1)} dtk`}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-xl bg-subtle px-3 py-2 text-sm text-muted">Belum ada pemakaian minggu ini.</p>
            )}
          </Card>
        </div>

        <Card title="Panggilan terakhir" icon="receipt">
          {u.terakhir.length ? (
            <div className="overflow-x-auto">
              <table className="table text-sm">
                <thead>
                  <tr>
                    <th>Waktu</th>
                    <th>Fitur</th>
                    <th className="hidden sm:table-cell">Penyedia · model</th>
                    <th>Status</th>
                    <th className="hidden text-right sm:table-cell">Durasi</th>
                    <th className="text-right">Token</th>
                  </tr>
                </thead>
                <tbody>
                  {u.terakhir.map((c) => (
                    <tr key={c.id}>
                      <td className="num whitespace-nowrap">
                        {fmtTanggal(wibDate(c.waktu))} {jamMenit(c.waktu)}
                      </td>
                      <td className="whitespace-nowrap">{LABEL_FITUR[c.fitur as keyof typeof LABEL_FITUR] ?? c.fitur}</td>
                      <td className="hidden sm:table-cell">
                        {c.penyedia === "claude" ? "Claude" : c.penyedia === "gemini" ? "Gemini" : "OpenRouter"} · {c.model}
                      </td>
                      <td>
                        <span title={c.catatan ?? undefined}>
                          <Badge tone={c.status === "ok" ? "ok" : c.status === "sibuk" || c.status === "timeout" || c.status === "limit" ? "warn" : "bad"}>
                            {c.status === "ok" ? "Berhasil" : LABEL_KONDISI[c.status as keyof typeof LABEL_KONDISI] ?? c.status}
                          </Badge>
                        </span>
                      </td>
                      <td className="num hidden text-right sm:table-cell">{(c.durasiMs / 1000).toFixed(1)} dtk</td>
                      <td className="num text-right">{c.tokenMasuk + c.tokenKeluar ? angka(c.tokenMasuk + c.tokenKeluar) : "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="rounded-xl bg-subtle px-3 py-2 text-sm text-muted">Belum ada panggilan ke Claude.</p>
          )}
        </Card>
      </section>
    </div>
  );
}
