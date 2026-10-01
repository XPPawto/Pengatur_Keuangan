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

// Tool yang bisa keluar dari folder kerja / internet / menulis: ditolak lewat Policy Engine Gemini CLI.
const TOOL_DITOLAK = ["run_shell_command", "web_fetch", "google_web_search", "write_file", "replace", "save_memory"];
const POLICY = `# Dibuat otomatis oleh DompetKos. Asisten keuangan hanya boleh membaca file di folder kerjanya.
[[rule]]
toolName = ${JSON.stringify(TOOL_DITOLAK)}
decision = "deny"
priority = 999
`;

/** Pengaturan Gemini CLI khusus bot: hanya tool baca file, tanpa web/shell/tulis, tanpa telemetri. */
export function tulisPengaturan(apiKey: string | null) {
  const dir = path.join(GEMINI_HOME(), ".gemini");
  fs.mkdirSync(path.join(dir, "policies"), { recursive: true, mode: 0o700 });
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
    // tools.exclude sudah usang (diganti policy di bawah); tools.core tetap membatasi tool yang dimuat
    tools: { core: ["read_file", "read_many_files"] },
    privacy: { usageStatisticsEnabled: false },
    telemetry: { enabled: false },
    general: { ...(lama.general as object), disableAutoUpdate: true, disableUpdateNag: true },
  };
  fs.writeFileSync(p, JSON.stringify(isi, null, 2), { mode: 0o600 });
  fs.writeFileSync(path.join(dir, "policies", "dompetkos.toml"), POLICY, { mode: 0o600 });
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

/** Objek JSON terakhir yang dimulai di awal baris (stderr Gemini CLI berisi peringatan + stack trace sebelum JSON-nya). */
function jsonTerakhir(teks: string): Record<string, unknown> | null {
  const b = teks.lastIndexOf("}");
  for (let i = teks.lastIndexOf("\n{"); i >= 0; i = teks.lastIndexOf("\n{", i - 1)) {
    try {
      return JSON.parse(teks.slice(i + 1, b + 1));
    } catch {
      /* coba yang lebih awal */
    }
  }
  return teks.startsWith("{") ? jsonDari(teks) : null;
}

/** Pesan error Gemini sering berupa JSON di dalam JSON di dalam string; ambil pesan & kode paling dalam. */
export function bukaPesan(pesan: string, kode: number | null = null): { pesan: string; kode: number | null } {
  for (let i = 0; i < 5; i++) {
    let j: { error?: { message?: unknown; code?: unknown } } | null = null;
    try {
      j = JSON.parse(pesan);
    } catch {
      break;
    }
    if (typeof j?.error?.message !== "string") break;
    pesan = j.error.message;
    if (typeof j.error.code === "number") kode = j.error.code;
  }
  return { pesan: pesan.trim(), kode };
}

/** Ambil pesan error yang berguna dari keluaran Gemini CLI, buang peringatan & stack trace. */
export function pesanGagalGemini(out: string, err: string): { pesan: string; kode: number | null } {
  const e = ((jsonDari(out)?.error ?? jsonTerakhir(err)?.error) ?? null) as { message?: unknown; code?: unknown } | null;
  if (e && typeof e.message === "string") return bukaPesan(e.message, typeof e.code === "number" ? e.code : null);
  const baris = err
    .replace(/\u001b\[[0-9;]*m/g, "")
    .split("\n")
    .map((b) => b.trim())
    .filter((b) => b && !/^(Warning:|\[STARTUP\]|at |Loaded cached|Data collection)/.test(b));
  const inti = baris.find((b) => /error|invalid|denied|quota|exhausted|not found/i.test(b)) ?? baris[0];
  return { pesan: inti || "Gemini gagal tanpa pesan", kode: null };
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
    env.COLORTERM = "truecolor"; // tanpa ini CLI mencetak peringatan warna terminal ke stderr
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
      const { pesan, kode } = pesanGagalGemini(out, err);
      selesai({ ok: false, alasan: golongkanGemini(pesan, kode), pesan: pesan.slice(0, 300), token });
    });
    child.stdin!.on("error", () => {});
    child.stdin!.end(promptAkhir);
  });

// ---------------------------------------------------------------- jalur API key: API resmi Gemini langsung

const API_GEMINI = "https://generativelanguage.googleapis.com/v1beta";
const MIME_GAMBAR: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".heic": "image/heic", ".heif": "image/heif" };

/**
 * Dengan API key, Gemini dipanggil lewat API resmi Google (generativelanguage.googleapis.com) langsung:
 * tidak perlu memasang Gemini CLI, tanpa tool sama sekali, dan error-nya jelas. Kunci dikirim lewat header.
 */
export const penjalanGeminiApi: PenjalanGemini = async (p) => {
  const mulai = Date.now();
  const hasil = (h: HasilTanpaDurasi) => ({ ...h, durasiMs: Date.now() - mulai }) as HasilClaude;
  if (!p.apiKey) return hasil({ ok: false, alasan: "belum_diatur", pesan: "API key Gemini belum diisi." });
  if (!/^[\w.-]{1,80}$/.test(p.model)) return hasil({ ok: false, alasan: "gagal", pesan: `Nama model "${p.model}" tidak valid.` });

  const bagian: unknown[] = [{ text: p.gambar ? p.prompt.replace(/\.\/foto[^\s]*/g, "foto terlampir") : p.prompt }];
  if (p.gambar) {
    try {
      const mime = MIME_GAMBAR[path.extname(p.gambar).toLowerCase()] ?? "image/jpeg";
      bagian.push({ inline_data: { mime_type: mime, data: fs.readFileSync(p.gambar).toString("base64") } });
    } catch (e) {
      return hasil({ ok: false, alasan: "gagal", pesan: `Foto tidak bisa dibaca: ${e instanceof Error ? e.message : e}` });
    }
  }
  let r: Response;
  try {
    r = await fetch(`${API_GEMINI}/models/${p.model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": p.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: p.system }] }, contents: [{ role: "user", parts: bagian }] }),
      signal: AbortSignal.timeout(p.timeoutMs ?? 90_000),
    });
  } catch (e) {
    const timeout = e instanceof Error && e.name === "TimeoutError";
    return hasil({ ok: false, alasan: timeout ? "timeout" : "sibuk", pesan: timeout ? "Gemini tidak menjawab tepat waktu" : `Tidak bisa menghubungi Gemini: ${e instanceof Error ? e.message : e}` });
  }
  const j = (await r.json().catch(() => null)) as {
    candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
    promptFeedback?: { blockReason?: string };
    error?: { message?: string; code?: number; status?: string };
  } | null;
  const u = j?.usageMetadata;
  const token = u ? { masuk: Math.round(u.promptTokenCount ?? 0), keluar: Math.round((u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0)) } : undefined;
  if (!r.ok || j?.error) {
    const pesan = `${j?.error?.message || `Gemini ${r.status}`}${j?.error?.status ? ` (${j.error.status})` : ""}`.slice(0, 300);
    return hasil({ ok: false, alasan: golongkanGemini(pesan, j?.error?.code ?? r.status), pesan, token });
  }
  const k = j?.candidates?.[0];
  const teks = (k?.content?.parts ?? [])
    .filter((b) => !b.thought && typeof b.text === "string")
    .map((b) => b.text)
    .join("")
    .trim();
  if (teks) return hasil({ ok: true, teks, token });
  const sebab = j?.promptFeedback?.blockReason ?? k?.finishReason;
  return hasil({ ok: false, alasan: "gagal", pesan: sebab ? `Gemini tidak memberi jawaban (${sebab}).` : "Gemini membalas kosong.", token });
};

/** API key → API resmi langsung; login akun Google → Gemini CLI. */
export const penjalanGeminiOtomatis: PenjalanGemini = (p) => (p.apiKey ? penjalanGeminiApi(p) : penjalanGeminiCli(p));
