import ActionForm from "./ActionForm";
import ConfirmButton from "./ConfirmButton";
import { Icon } from "./icons";
import { Badge } from "./ui";
import { hapusKunciCadanganAction, simpanCadanganAction, simpanKunciCadanganAction, tesCadanganAction } from "@/app/actions-ai";
import type { statusCadangan } from "@/lib/ai/panggil";
import type { ModelGratis } from "@/lib/ai/openrouter";

type Cadangan = Awaited<ReturnType<typeof statusCadangan>>[number];

const MODEL_GEMINI = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-pro"];

function nada(c: Cadangan): "ok" | "warn" | "neutral" {
  if (!c.aktif || !c.ada) return "neutral";
  return c.kondisi === "ok" ? "ok" : c.siap ? "neutral" : "warn";
}

/** Pengaturan penyedia AI cadangan (Gemini CLI, OpenRouter gratis) di halaman Koneksi. */
export default function CadanganPanel({
  cadangan,
  claudeAktif,
  urutan,
  modelGemini,
  modelGeminiRingan,
  modelOpenRouter,
  modelGratis,
}: {
  cadangan: Cadangan[];
  claudeAktif: boolean;
  urutan: string;
  modelGemini: string;
  modelGeminiRingan: string;
  modelOpenRouter: string;
  modelGratis: ModelGratis[] | null;
}) {
  const g = cadangan.find((c) => c.penyedia === "gemini")!;
  const o = cadangan.find((c) => c.penyedia === "openrouter")!;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div id="gemini" className="card card-pad scroll-mt-20">
          <Judul c={g} ikon="sparkles" />
          <p className="mb-3 text-sm text-muted">
            Lewat <b>Gemini CLI</b> resmi Google, gratis. Pilih salah satu: login akun Google sekali di server, atau API key gratis dari Google AI Studio.
          </p>
          {!g.ada && (
            <ol className="mb-3 space-y-2 text-sm">
              <li>
                <b>Cara A (login Google):</b> pasang lalu login sekali di folder khusus bot:
                <code className="mt-1 block overflow-x-auto rounded-lg bg-subtle px-3 py-2 text-xs">npm i -g @google/gemini-cli{"\n"}HOME=$PWD/data/gemini-home NO_BROWSER=true gemini</code>
                <span className="hint">Pilih &quot;Login with Google&quot;, buka link-nya di HP, tempel kodenya, lalu keluar (/quit).</span>
              </li>
              <li>
                <b>Cara B (API key):</b> buat key gratis di <span className="font-medium">aistudio.google.com</span> → Get API key, lalu tempel di bawah. Tetap butuh <code>npm i -g @google/gemini-cli</code>.
              </li>
            </ol>
          )}
          <Kunci c={g} placeholder="AIza…" />
          <p className="mt-3 text-xs text-muted">Catatan privasi: di paket gratis Google, data yang dikirim bisa dipakai untuk meningkatkan layanan Google.</p>
        </div>

        <div id="openrouter" className="card card-pad scroll-mt-20">
          <Judul c={o} ikon="transfer" />
          <p className="mb-3 text-sm text-muted">
            Hanya memakai <b>model gratis</b> (berakhiran <code>:free</code>); model berbayar ditolak sebelum dikirim, jadi tidak ada tagihan. Buat API key di <span className="font-medium">openrouter.ai/keys</span>.
          </p>
          <Kunci c={o} placeholder="sk-or-v1-…" />
          <p className="mt-3 text-xs text-muted">
            Batas gratis OpenRouter sekitar 50 permintaan/hari. Sebagian model gratis mewajibkan izin &quot;model training&quot; di pengaturan privasi OpenRouter, artinya data bisa dipakai penyedia modelnya.
          </p>
        </div>
      </div>

      <div className="card card-pad">
        <h3 className="mb-3 flex items-center gap-2 text-[15px] font-semibold">
          <Icon name="settings" size={18} className="text-muted" />
          Urutan & model
        </h3>
        <ActionForm action={simpanCadanganAction} submit="Simpan" submitClass="btn-secondary">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Saklar nama="ai_claude_aktif" label="Claude (utama)" on={claudeAktif} />
            <Saklar nama="ai_gemini_aktif" label="Gemini (cadangan)" on={g.aktif} />
            <Saklar nama="ai_openrouter_aktif" label="OpenRouter (cadangan)" on={o.aktif} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label htmlFor="ai_urutan_cadangan" className="label">
                Setelah Claude, coba
              </label>
              <select id="ai_urutan_cadangan" name="ai_urutan_cadangan" defaultValue={urutan} className="input">
                <option value="gemini,openrouter">Gemini → OpenRouter</option>
                <option value="openrouter,gemini">OpenRouter → Gemini</option>
              </select>
            </div>
            <div>
              <label htmlFor="ai_gemini_model" className="label">
                Model Gemini
              </label>
              <select id="ai_gemini_model" name="ai_gemini_model" defaultValue={modelGemini} className="input">
                {[...new Set([modelGemini, ...MODEL_GEMINI])].map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="ai_gemini_model_ringan" className="label">
                Gemini tugas kecil
              </label>
              <select id="ai_gemini_model_ringan" name="ai_gemini_model_ringan" defaultValue={modelGeminiRingan} className="input">
                {[...new Set([modelGeminiRingan, ...MODEL_GEMINI])].map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="ai_openrouter_model" className="label">
                Model OpenRouter (gratis)
              </label>
              <select id="ai_openrouter_model" name="ai_openrouter_model" defaultValue={modelOpenRouter} className="input">
                <option value="">Otomatis (gratis terbaik)</option>
                {modelOpenRouter && !modelGratis?.some((m) => m.id === modelOpenRouter) && <option value={modelOpenRouter}>{modelOpenRouter}</option>}
                {(modelGratis ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nama}
                    {m.gambar ? " · bisa baca foto" : ""}
                  </option>
                ))}
              </select>
              {modelGratis === null && <p className="hint">Daftar model gratis belum bisa diambil dari OpenRouter.</p>}
            </div>
          </div>
        </ActionForm>
      </div>
    </div>
  );
}

function Judul({ c, ikon }: { c: Cadangan; ikon: "sparkles" | "transfer" }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h3 className="flex items-center gap-2 text-[15px] font-semibold">
        <Icon name={ikon} size={18} className="text-muted" />
        {c.label}
      </h3>
      <Badge tone={nada(c)}>{!c.aktif ? "Mati" : c.labelKondisi}</Badge>
    </div>
  );
}

function Kunci({ c, placeholder }: { c: Cadangan; placeholder: string }) {
  return (
    <div className="space-y-2">
      {c.ada && (
        <p className="text-sm">
          {c.sumber === "login" ? "Login akun Google tersimpan di folder bot" : <>API key <span className="num">{c.samaran}</span>{c.sumber === "env" ? " (.env)" : ""}</>}
          {c.model ? <span className="text-muted"> · model {c.model}</span> : null}
        </p>
      )}
      {c.pesan && !c.siap && c.ada && <p className="rounded-lg bg-warn-bg px-3 py-2 text-xs text-warn">{c.pesan}</p>}
      {c.ada && (
        <ActionForm action={tesCadanganAction} submit={<><Icon name="refresh" size={15} />Tes koneksi</>} submitClass="btn-secondary btn-sm w-full">
          <input type="hidden" name="penyedia" value={c.penyedia} />
        </ActionForm>
      )}
      <details open={!c.ada}>
        <summary className="cursor-pointer text-sm font-medium text-brand">{c.ada ? "Ganti API key" : "Pakai API key"}</summary>
        <div className="mt-2">
          <ActionForm action={simpanKunciCadanganAction} submit={<><Icon name="key" size={15} />Simpan & tes</>} submitClass="btn btn-sm" resetOnOk>
            <input type="hidden" name="penyedia" value={c.penyedia} />
            <label htmlFor={`kunci-${c.penyedia}`} className="sr-only">
              API key {c.label}
            </label>
            <input id={`kunci-${c.penyedia}`} name="kunci" type="password" autoComplete="off" spellCheck={false} placeholder={placeholder} className="input num" required />
          </ActionForm>
        </div>
      </details>
      {c.sumber === "website" && (
        <form action={hapusKunciCadanganAction}>
          <input type="hidden" name="penyedia" value={c.penyedia} />
          <ConfirmButton pesan={`Hapus API key ${c.label}?`} className="btn-ghost btn-sm w-full text-bad">
            <Icon name="trash" size={15} />
            Hapus API key
          </ConfirmButton>
        </form>
      )}
    </div>
  );
}

function Saklar({ nama, label, on }: { nama: string; label: string; on: boolean }) {
  return (
    <label htmlFor={nama} className="flex cursor-pointer items-center gap-3 rounded-xl border border-line px-3 py-2.5">
      <input type="checkbox" id={nama} name={nama} defaultChecked={on} className="size-4 shrink-0 accent-[var(--brand)]" />
      <span className="text-sm font-medium">{label}</span>
    </label>
  );
}
