import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Pemanggil Claude lewat Claude Code CLI (`claude -p`) memakai langganan Claude Pro/Max pemilik,
 * bukan API key berbayar per token.
 *
 * Isolasi (server dipakai bareng orang lain):
 * - Autentikasi dari token `claude setup-token` milik pemilik (CLAUDE_CODE_OAUTH_TOKEN), atau login di
 *   folder konfigurasi khusus bot (AI_CONFIG_DIR). Login/logout Claude Code orang lain di terminal tidak
 *   berpengaruh, dan bot tidak pernah memakai akun orang lain.
 * - Lingkungan proses dibuat dari nol: ANTHROPIC_API_KEY dkk. tidak diteruskan, jadi tidak mungkin
 *   tertagih API berbayar.
 * - Semua tool Claude Code dimatikan (kecuali Read untuk membaca foto struk di folder kerja sementara),
 *   dan folder kerjanya di luar repo supaya tidak membaca file proyek.
 * - Prompt (berisi data keuangan) dikirim lewat stdin, bukan argumen, supaya tidak terlihat di `ps`.
 */

export type AlasanGagal =
  | "dimatikan" // saklar AI di Pengaturan mati
  | "belum_diatur" // belum ada token / login
  | "kuota" // batas harian dari Pengaturan tercapai
  | "belum_login" // token ditolak / kedaluwarsa / logout
  | "limit" // batas pemakaian langganan Claude
  | "sibuk" // server Claude sedang penuh
  | "timeout"
  | "tidak_ada" // perintah `claude` tidak ditemukan
  | "gagal";

export interface PanggilanClaude {
  /** instruksi tetap (peran, aturan, format jawaban) */
  system: string;
  /** isi permintaan (konteks + pertanyaan); dikirim lewat stdin */
  prompt: string;
  /** alias model Claude Code: sonnet | opus | haiku | fable, atau nama lengkap */
  model: string;
  /** path file gambar (mis. struk) yang boleh dibaca Claude */
  gambar?: string;
  timeoutMs?: number;
}

export interface PemakaianToken {
  masuk: number;
  keluar: number;
}

/** Satu jendela batas langganan Claude (sesi 5 jam, mingguan, ...). */
export interface JendelaBatas {
  /** persen terpakai (0–100, bisa sedikit di atas 100) */
  persen: number;
  /** waktu reset, detik epoch Unix */
  resetsAt: number | null;
}

export const JENDELA = ["five_hour", "seven_day", "seven_day_opus", "seven_day_sonnet"] as const;
export type NamaJendela = (typeof JENDELA)[number];

/** Batas langganan yang dilaporkan Claude Code lewat `rate_limit_event` (dari header respons Claude). */
export interface InfoBatas {
  /** allowed | allowed_warning | rejected */
  status?: string;
  /** jendela yang sedang membatasi */
  jenis?: string;
  resetsAt?: number | null;
  jendela: Partial<Record<NamaJendela, JendelaBatas>>;
}

export type HasilClaude =
  | { ok: true; teks: string; durasiMs: number; token?: PemakaianToken; batas?: InfoBatas }
  | { ok: false; alasan: AlasanGagal; pesan: string; durasiMs: number; token?: PemakaianToken; batas?: InfoBatas };

export type Penjalan = (p: PanggilanClaude & { token: string | null }) => Promise<HasilClaude>;

export const CLAUDE_BIN = () => process.env.CLAUDE_BIN || "claude";
export const AI_CONFIG_DIR = () => path.resolve(process.env.AI_CONFIG_DIR || "./data/claude-config");
export const AI_WORK_DIR = () => path.resolve(process.env.AI_WORK_DIR || path.join(os.tmpdir(), "dompetkos-ai"));

/** Ada login tersimpan di folder konfigurasi bot (alternatif token). */
export function adaLoginFolder(): boolean {
  return fs.existsSync(path.join(AI_CONFIG_DIR(), ".credentials.json"));
}

const DITERUSKAN = ["PATH", "LANG", "LC_ALL", "TZ", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "https_proxy", "http_proxy", "no_proxy", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE"];

export function lingkunganProses(token: string | null): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of DITERUSKAN) if (process.env[k]) env[k] = process.env[k]!;
  const dir = AI_CONFIG_DIR();
  env.HOME = dir;
  env.CLAUDE_CONFIG_DIR = dir;
  env.DISABLE_AUTOUPDATER = "1";
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
  if (token) env.CLAUDE_CODE_OAUTH_TOKEN = token;
  return env;
}

export function argumen(p: PanggilanClaude): string[] {
  // stream-json (+ --verbose) supaya ikut menerima rate_limit_event: pemakaian sesi 5 jam & mingguan
  const args = ["-p", "--output-format", "stream-json", "--verbose", "--model", p.model, "--system-prompt", p.system, "--no-session-persistence", "--strict-mcp-config"];
  if (p.gambar) args.push("--tools", "Read", "--allowedTools", "Read", "--max-turns", "4");
  else args.push("--tools", "", "--max-turns", "1");
  return args;
}

const RE_LOGIN = /(not logged in|invalid (api key|bearer)|authenticat|oauth|\/login|token (has )?expired|unauthori[sz]ed|401|403)/i;
const RE_LIMIT = /(usage limit|rate.?limit|hit your limit|limit reached|429|quota)/i;
const RE_SIBUK = /(overloaded|529|503|502|500|internal server error|timed? ?out)/i;

/** Golongkan pesan error Claude Code jadi alasan yang bisa ditindaklanjuti. */
export function golongkan(pesan: string, status?: number | null): AlasanGagal {
  if (status === 401 || status === 403) return "belum_login";
  if (status === 429) return "limit";
  if (status && status >= 500) return "sibuk";
  if (RE_LOGIN.test(pesan)) return "belum_login";
  if (RE_LIMIT.test(pesan)) return "limit";
  if (RE_SIBUK.test(pesan)) return "sibuk";
  return "gagal";
}

interface HasilJson {
  type?: string;
  is_error?: boolean;
  result?: string;
  subtype?: string;
  api_error_status?: number | null;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
}

export function tokenDari(j: HasilJson | null): PemakaianToken | undefined {
  const u = j?.usage;
  if (!u) return undefined;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);
  return { masuk: n(u.input_tokens) + n(u.cache_read_input_tokens) + n(u.cache_creation_input_tokens), keluar: n(u.output_tokens) };
}

function barisJson(stdout: string): Record<string, unknown>[] {
  const t = stdout.trim();
  const out: Record<string, unknown>[] = [];
  for (const c of t.startsWith("{") && !t.includes("\n") ? [t] : t.split("\n")) {
    const s = c.trim();
    if (!s.startsWith("{")) continue;
    try {
      const j = JSON.parse(s);
      if (j && typeof j === "object") out.push(j);
    } catch {
      /* bukan JSON */
    }
  }
  return out;
}

/** Ambil objek hasil dari stdout `--output-format stream-json` / `json` (toleran terhadap baris lain). */
export function bacaKeluaran(stdout: string): HasilJson | null {
  const semua = barisJson(stdout).reverse();
  return (semua.find((j) => j.type === "result") ?? semua.find((j) => "result" in j) ?? null) as HasilJson | null;
}

/** persen dari utilization (0–1; nilai > 2 dianggap sudah persen). */
function persen(u: unknown): number | null {
  if (typeof u !== "number" || !Number.isFinite(u) || u < 0) return null;
  return Math.round((u > 2 ? u : u * 100) * 10) / 10;
}
const detik = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v > 1e12 ? v / 1000 : v) : null);

/**
 * Kumpulkan info batas langganan dari semua `rate_limit_event` di keluaran. Mendukung bidang
 * per-jendela (`unifiedWindows`: five_hour, seven_day, …) maupun bidang utama (rateLimitType + utilization).
 * Event yang lebih akhir menimpa yang lebih awal. undefined kalau tidak ada data.
 */
export function bacaBatas(stdout: string): InfoBatas | undefined {
  let info: InfoBatas | undefined;
  for (const j of barisJson(stdout)) {
    if (j.type !== "rate_limit_event") continue;
    const r = j.rate_limit_info as Record<string, unknown> | undefined;
    if (!r || typeof r !== "object") continue;
    info ??= { jendela: {} };
    if (typeof r.status === "string") info.status = r.status;
    if (typeof r.rateLimitType === "string") info.jenis = r.rateLimitType;
    if (r.resetsAt !== undefined) info.resetsAt = detik(r.resetsAt);
    const jenis = r.rateLimitType as NamaJendela;
    const p = persen(r.utilization);
    if (JENDELA.includes(jenis) && p !== null) info.jendela[jenis] = { persen: p, resetsAt: detik(r.resetsAt) };
    const w = (r.unifiedWindows ?? r.windows) as Record<string, { utilization?: unknown; resetsAt?: unknown; resets_at?: unknown }> | undefined;
    if (w && typeof w === "object") {
      for (const k of JENDELA) {
        const x = w[k];
        const px = persen(x?.utilization);
        if (x && px !== null) info.jendela[k] = { persen: px, resetsAt: detik(x.resetsAt ?? x.resets_at) };
      }
    }
  }
  return info;
}

/** Penjalan sungguhan: spawn `claude -p`. */
export const penjalanCli: Penjalan = (p) =>
  new Promise((resolve) => {
    const mulai = Date.now();
    const selesai = (h: Omit<Extract<HasilClaude, { ok: false }>, "durasiMs"> | Omit<Extract<HasilClaude, { ok: true }>, "durasiMs">) =>
      resolve({ ...h, durasiMs: Date.now() - mulai } as HasilClaude);

    const cwd = AI_WORK_DIR();
    try {
      fs.mkdirSync(cwd, { recursive: true, mode: 0o700 });
      fs.mkdirSync(AI_CONFIG_DIR(), { recursive: true, mode: 0o700 });
    } catch {
      /* ditangani saat spawn */
    }

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(CLAUDE_BIN(), argumen(p), { cwd, env: lingkunganProses(p.token) as unknown as NodeJS.ProcessEnv, stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) {
      return selesai({ ok: false, alasan: "tidak_ada", pesan: String(e) });
    }

    let out = "";
    let err = "";
    let beres = false;
    const timer = setTimeout(() => {
      if (beres) return;
      beres = true;
      child.kill("SIGKILL");
      selesai({ ok: false, alasan: "timeout", pesan: `Claude tidak menjawab dalam ${Math.round((p.timeoutMs ?? 90_000) / 1000)} detik` });
    }, p.timeoutMs ?? 90_000);

    child.stdout!.on("data", (d) => (out += d));
    child.stderr!.on("data", (d) => (err += d));
    child.on("error", (e: NodeJS.ErrnoException) => {
      if (beres) return;
      beres = true;
      clearTimeout(timer);
      selesai({ ok: false, alasan: e.code === "ENOENT" ? "tidak_ada" : "gagal", pesan: e.code === "ENOENT" ? `Perintah "${CLAUDE_BIN()}" tidak ditemukan. Pasang Claude Code dulu.` : e.message });
    });
    child.on("close", (code) => {
      if (beres) return;
      beres = true;
      clearTimeout(timer);
      const j = bacaKeluaran(out);
      const token = tokenDari(j);
      const batas = bacaBatas(out);
      if (j && !j.is_error && typeof j.result === "string" && j.subtype === "success") return selesai({ ok: true, teks: j.result, token, batas });
      // tanpa baris result: pakai stderr / teks non-JSON saja (baris event JSON bisa memicu salah golong)
      const teksLain = out
        .split("\n")
        .filter((l) => !l.trim().startsWith("{"))
        .join("\n");
      const pesan = (j?.result || err || teksLain || `keluar dengan kode ${code}`).trim().slice(0, 300);
      const alasan = batas?.status === "rejected" ? "limit" : golongkan(pesan, j?.api_error_status);
      selesai({ ok: false, alasan, pesan, token, batas });
    });
    child.stdin!.on("error", () => {
      /* proses mati sebelum stdin selesai; ditangani di close */
    });
    child.stdin!.end(p.prompt);
  });
