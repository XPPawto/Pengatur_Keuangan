import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AlasanGagal, HasilClaude, HasilTanpaDurasi, PanggilanClaude } from "./claude";

/**
 * Cadangan: Gemini lewat Gemini CLI resmi (`gemini -p`), login akun Google pemilik atau API key gratis
 * Google AI Studio. Isolasinya sama dengan Claude: folder HOME khusus bot, lingkungan proses dibuat dari nol,
 * tool yang bisa keluar (web, shell, tulis file, memori) dimatikan lewat settings.json, prompt lewat stdin.
 */

export type PenjalanGemini = (p: PanggilanClaude & { apiKey: string | null }) => Promise<HasilClaude>;

export const GEMINI_BIN = () => process.env.GEMINI_BIN || "gemini";
export const GEMINI_HOME = () => path.resolve(process.env.GEMINI_HOME || "./data/gemini-home");

/** Sudah login akun Google di folder bot (alternatif API key). */
export function adaLoginGemini(): boolean {
  return fs.existsSync(path.join(GEMINI_HOME(), ".gemini", "oauth_creds.json"));
}

const DITERUSKAN = ["PATH", "LANG", "LC_ALL", "TZ", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "https_proxy", "http_proxy", "no_proxy", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE"];

/** Pengaturan Gemini CLI khusus bot: hanya tool baca file, tanpa web/shell/tulis, tanpa telemetri. */
export function tulisPengaturan(apiKey: string | null) {
  const dir = path.join(GEMINI_HOME(), ".gemini");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const p = path.join(dir, "settings.json");
  let lama: Record<string, unknown> = {};
  try {
    lama = JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    /* belum ada */
  }
  const isi = {
    ...lama,
    security: { ...(lama.security as object), auth: { selectedType: apiKey ? "gemini-api-key" : "oauth-personal" } },
    tools: { core: ["read_file", "read_many_files"], exclude: ["run_shell_command", "web_fetch", "google_web_search", "write_file", "replace", "save_memory"] },
    privacy: { usageStatisticsEnabled: false },
    telemetry: { enabled: false },
    general: { ...(lama.general as object), disableAutoUpdate: true, disableUpdateNag: true },
  };
  fs.writeFileSync(p, JSON.stringify(isi, null, 2), { mode: 0o600 });
}

export function argumenGemini(model: string): string[] {
  return ["-p", "", "-o", "json", "-m", model, "--approval-mode", "plan"];
}

/** Golongkan error Gemini CLI. */
export function golongkanGemini(pesan: string, kode?: number | null): AlasanGagal {
  if (/set an auth method|GEMINI_API_KEY, GOOGLE_GENAI/i.test(pesan)) return "belum_diatur";
  if (kode === 401 || kode === 403 || /api key not valid|API_KEY_INVALID|unauthenticated|permission denied|invalid_grant|login|credential/i.test(pesan)) return "belum_login";
  if (kode === 429 || /quota|RESOURCE_EXHAUSTED|rate limit|too many requests/i.test(pesan)) return "limit";
  if ((kode && kode >= 500) || /overloaded|unavailable|internal error|deadline/i.test(pesan)) return "sibuk";
  return "gagal";
}

function jsonDari(teks: string): Record<string, unknown> | null {
  const a = teks.indexOf("{");
  const b = teks.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    return JSON.parse(teks.slice(a, b + 1));
  } catch {
    return null;
  }
}

/** Jumlahkan token dari bagian stats Gemini CLI (bentuknya bisa berubah antar versi; dibaca longgar). */
function tokenGemini(stats: unknown): { masuk: number; keluar: number } | undefined {
  let masuk = 0;
  let keluar = 0;
  const jalan = (o: unknown) => {
    if (!o || typeof o !== "object") return;
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === "number") {
        if (/^(prompt|input)/i.test(k)) masuk += v;
        else if (/^(candidates|output)/i.test(k)) keluar += v;
      } else jalan(v);
    }
  };
  jalan(stats);
  return masuk || keluar ? { masuk: Math.round(masuk), keluar: Math.round(keluar) } : undefined;
}

export const penjalanGeminiCli: PenjalanGemini = (p) =>
  new Promise((resolve) => {
    const mulai = Date.now();
    const selesai = (h: HasilTanpaDurasi) => resolve({ ...h, durasiMs: Date.now() - mulai } as HasilClaude);

    // folder kerja unik per panggilan: berisi prompt sistem (+ foto kalau ada), dihapus setelah selesai
    let kerja: string;
    try {
      tulisPengaturan(p.apiKey);
      kerja = fs.mkdtempSync(path.join(os.tmpdir(), "dompetkos-gemini-"));
      fs.writeFileSync(path.join(kerja, "sistem.md"), p.system, { mode: 0o600 });
    } catch (e) {
      return selesai({ ok: false, alasan: "gagal", pesan: String(e) });
    }
    let promptAkhir = p.prompt;
    if (p.gambar) {
      const nama = `foto${path.extname(p.gambar) || ".jpg"}`;
      fs.copyFileSync(p.gambar, path.join(kerja, nama));
      promptAkhir = `@${nama}\n\n${p.prompt.replace(/\.\/foto[^\s]*/g, nama)}`;
    }

    const env: Record<string, string> = {};
    for (const k of DITERUSKAN) if (process.env[k]) env[k] = process.env[k]!;
    env.HOME = GEMINI_HOME();
    env.GEMINI_SYSTEM_MD = path.join(kerja, "sistem.md");
    env.GEMINI_CLI_TRUST_WORKSPACE = "true";
    env.NO_BROWSER = "true";
    if (p.apiKey) env.GEMINI_API_KEY = p.apiKey;

    const bersih = () => fs.rmSync(kerja, { recursive: true, force: true });
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(GEMINI_BIN(), argumenGemini(p.model), { cwd: kerja, env: env as unknown as NodeJS.ProcessEnv, stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) {
      bersih();
      return selesai({ ok: false, alasan: "tidak_ada", pesan: String(e) });
    }
    let out = "";
    let err = "";
    let beres = false;
    const timer = setTimeout(() => {
      if (beres) return;
      beres = true;
      child.kill("SIGKILL");
      bersih();
      selesai({ ok: false, alasan: "timeout", pesan: `Gemini tidak menjawab dalam ${Math.round((p.timeoutMs ?? 90_000) / 1000)} detik` });
    }, p.timeoutMs ?? 90_000);
    child.stdout!.on("data", (d) => (out += d));
    child.stderr!.on("data", (d) => (err += d));
    child.on("error", (e: NodeJS.ErrnoException) => {
      if (beres) return;
      beres = true;
      clearTimeout(timer);
      bersih();
      selesai({ ok: false, alasan: e.code === "ENOENT" ? "tidak_ada" : "gagal", pesan: e.code === "ENOENT" ? `Perintah "${GEMINI_BIN()}" tidak ditemukan. Pasang Gemini CLI dulu.` : e.message });
    });
    child.on("close", () => {
      if (beres) return;
      beres = true;
      clearTimeout(timer);
      bersih();
      const j = jsonDari(out);
      const token = tokenGemini(j?.stats);
      if (j && typeof j.response === "string" && !j.error) return selesai({ ok: true, teks: j.response, token });
      const e = (j?.error ?? jsonDari(err)?.error) as { message?: string; code?: number } | undefined;
      const pesan = (e?.message || err.replace(/\u001b\[[0-9;]*m/g, "") || "Gemini gagal tanpa pesan").trim().slice(0, 300);
      selesai({ ok: false, alasan: golongkanGemini(pesan, typeof e?.code === "number" ? e.code : null), pesan, token });
    });
    child.stdin!.on("error", () => {});
    child.stdin!.end(promptAkhir);
  });
