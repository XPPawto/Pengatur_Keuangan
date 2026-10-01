import ActionForm from "./ActionForm";
import ConfirmButton from "./ConfirmButton";
import ProgressBar from "./ProgressBar";
import { Icon } from "./icons";
import { Badge } from "./ui";
import { hapusTokenAction, simpanTokenAction, tesKoneksiAction } from "@/app/actions-ai";
import type { statusAI } from "@/lib/ai/panggil";
import { fmtTanggal, wibDate, wibHM } from "@/lib/time";

type StatusAI = Awaited<ReturnType<typeof statusAI>>;

function waktu(iso: string | null): string {
  if (!iso) return "belum pernah";
  const d = new Date(iso);
  const { jam, menit } = wibHM(d);
  return `${fmtTanggal(wibDate(d))} ${String(jam).padStart(2, "0")}.${String(menit).padStart(2, "0")}`;
}

export function nadaStatus(st: StatusAI): "ok" | "warn" | "neutral" {
  if (st.kondisi === "ok") return "ok";
  if (st.siap || st.kondisi === "dimatikan" || st.kondisi === "belum_diatur") return "neutral";
  return "warn";
}

/** Status sambungan Claude + kelola token (dipakai di halaman Koneksi). */
export default function ClaudePanel({ st, model }: { st: StatusAI; model: string }) {
  const pakai = Math.round((st.pemakaian.hariIni / Math.max(1, st.pemakaian.batas)) * 100);
  if (!st.token.ada) {
    return (
      <ol className="space-y-3 text-sm">
        <Langkah n={1}>
          Pasang Claude Code di server yang menjalankan DompetKos:
          <code className="mt-1 block overflow-x-auto rounded-lg bg-subtle px-3 py-2 text-xs">curl -fsSL https://claude.ai/install.sh | bash</code>
        </Langkah>
        <Langkah n={2}>
          Buat token jangka panjang dari akun Claude Pro lo (login di browser, sekali saja):
          <code className="mt-1 block overflow-x-auto rounded-lg bg-subtle px-3 py-2 text-xs">claude setup-token</code>
          <span className="hint">Token ini khusus bot. Login/logout Claude Code orang lain di server tidak berpengaruh, dan tidak ada tagihan API.</span>
        </Langkah>
        <Langkah n={3}>
          Tempel tokennya di sini. Disimpan terenkripsi dan tidak pernah ditampilkan utuh.
          <div className="mt-2">
            <TokenForm />
          </div>
        </Langkah>
      </ol>
    );
  }
  return (
    <div>
      <dl className="space-y-2.5 text-sm">
        <Baris label="Kondisi">
          <Badge tone={nadaStatus(st)}>{st.label}</Badge>
        </Baris>
        <Baris label="Model">{model}</Baris>
        <div>
          <Baris label="Pemakaian hari ini">
            <span className="num font-medium">
              {st.pemakaian.hariIni} / {st.pemakaian.batas}
            </span>
          </Baris>
          <div className="mt-1.5">
            <ProgressBar persen={pakai} tone={pakai >= 100 ? "bad" : pakai >= 75 ? "warn" : "brand"} label="Pemakaian AI hari ini" />
          </div>
        </div>
        <Baris label="Terakhir berhasil">{waktu(st.terakhirOk)}</Baris>
        <Baris label="Token">
          <span className="num">
            {st.token.samaran ?? (st.token.sumber === "folder" ? "login folder bot" : "belum ada")}
            {st.token.sumber === "env" ? " (.env)" : ""}
          </span>
        </Baris>
      </dl>
      {st.pesan && !st.siap && <p className="mt-3 rounded-lg bg-warn-bg px-3 py-2 text-xs text-warn">{st.pesan}</p>}
      <div className="mt-3 space-y-2 border-t border-line pt-3">
        <ActionForm
          action={tesKoneksiAction}
          submit={
            <>
              <Icon name="refresh" size={15} />
              Tes koneksi
            </>
          }
          submitClass="btn-secondary btn-sm w-full"
        >
          <></>
        </ActionForm>
        <details>
          <summary className="cursor-pointer text-sm font-medium text-brand">Ganti token</summary>
          <div className="mt-2">
            <TokenForm />
          </div>
        </details>
        {st.token.sumber === "website" && (
          <form action={hapusTokenAction}>
            <ConfirmButton pesan="Hapus token Claude? Fitur AI akan mati sampai token baru dipasang." className="btn-ghost btn-sm w-full text-bad">
              <Icon name="trash" size={15} />
              Hapus token
            </ConfirmButton>
          </form>
        )}
      </div>
    </div>
  );
}

function Baris({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

function Langkah({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-bold text-brand">{n}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </li>
  );
}

function TokenForm() {
  return (
    <ActionForm
      action={simpanTokenAction}
      submit={
        <>
          <Icon name="key" size={15} />
          Simpan & tes
        </>
      }
      submitClass="btn btn-sm"
      resetOnOk
    >
      <label htmlFor="token" className="sr-only">
        Token Claude
      </label>
      <input id="token" name="token" type="password" autoComplete="off" spellCheck={false} placeholder="sk-ant-oat01-…" className="input num" required />
    </ActionForm>
  );
}
