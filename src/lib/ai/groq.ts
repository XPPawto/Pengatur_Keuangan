import type { AlasanGagal, HasilClaude, HasilTanpaDurasi, PanggilanClaude } from "./claude";

/**
 * Penyedia cadangan: Groq (inferensi sangat cepat, API kompatibel OpenAI, ada paket gratis dengan batas per model).
 * Dipanggil langsung ke API resmi dengan API key dari console.groq.com. Tidak dipakai untuk gambar (dokumentasi Groq
 * tidak menyebut model mana yang mendukung gambar), jadi permintaan berfoto selalu dilewati ke penyedia lain.
 */

const API = "https://api.groq.com/openai/v1";

export type PenjalanGroq = (p: PanggilanClaude & { apiKey: string }) => Promise<HasilClaude>;

/** Nama model Groq: satu awalan vendor opsional ("openai/gpt-oss-120b"); tiap bagian diawali huruf/angka (tidak boleh "../"). */
export const modelGroqValid = (m: string) => /^[A-Za-z0-9][\w.\-]{0,60}(\/[A-Za-z0-9][\w.\-]{0,60})?$/.test(m);

/** Golongkan error Groq: 401/403 key; 429 batas (per model di paket gratis); 404/400 model tidak ada / dihentikan; 5xx sibuk. */
export function golongkanGroq(status: number, pesan: string, kode?: string): AlasanGagal {
  if (status === 401 || status === 403 || kode === "invalid_api_key") return "belum_login";
  if (status === 429 || kode === "rate_limit_exceeded" || /rate limit|tokens per|requests per/i.test(pesan)) return "limit";
  if (status === 413) return "limit"; // melebihi batas token per menit / ukuran permintaan model itu
  if (status >= 500 || status === 408) return "sibuk";
  return "gagal";
}

/** Model dihentikan / tidak ada / tidak boleh dipakai akun ini → jangan dicoba lagi sementara. */
export const modelGroqRusak = (pesan: string, kode?: string) => /model_not_found|model_decommissioned|decommissioned|does not exist|not found|no longer supported|terms/i.test(`${kode ?? ""} ${pesan}`);

export const penjalanGroq: PenjalanGroq = async (p) => {
  const mulai = Date.now();
  const hasil = (h: HasilTanpaDurasi) => ({ ...h, durasiMs: Date.now() - mulai }) as HasilClaude;
  if (!modelGroqValid(p.model)) return hasil({ ok: false, alasan: "gagal", pesan: `Nama model "${p.model.slice(0, 60)}" tidak valid untuk Groq.` });
  if (p.gambar) return hasil({ ok: false, alasan: "gagal", pesan: "Groq belum dipakai untuk membaca gambar." });

  let r: Response;
  try {
    r = await fetch(`${API}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${p.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: p.model, messages: [{ role: "system", content: p.system }, { role: "user", content: p.prompt }], max_completion_tokens: 2000 }),
      signal: AbortSignal.timeout(p.timeoutMs ?? 60_000),
    });
  } catch (e) {
    const habis = e instanceof Error && e.name === "TimeoutError";
    return hasil({ ok: false, alasan: habis ? "timeout" : "sibuk", pesan: habis ? "Groq tidak menjawab tepat waktu" : `Tidak bisa menghubungi Groq: ${e instanceof Error ? e.message : e}` });
  }
  let mentah: string;
  try {
    mentah = await r.text();
  } catch (e) {
    const habis = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return hasil({ ok: false, alasan: habis ? "timeout" : "sibuk", pesan: habis ? "Groq tidak menjawab tepat waktu" : `Jawaban Groq terputus: ${e instanceof Error ? e.message : e}` });
  }
  let j = null as {
    choices?: { message?: { content?: string | null }; finish_reason?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    error?: { message?: string; type?: string; code?: string };
  } | null;
  try {
    j = JSON.parse(mentah.trim());
  } catch {
    j = null;
  }
  const token = j?.usage ? { masuk: Math.round(j.usage.prompt_tokens ?? 0), keluar: Math.round(j.usage.completion_tokens ?? 0) } : undefined;
  const teks = j?.choices?.[0]?.message?.content;
  if (r.ok && !j?.error && typeof teks === "string" && teks.trim()) return hasil({ ok: true, teks, token });
  if (r.ok && !j?.error) {
    // 200 tanpa teks (mis. model reasoning menghabiskan batas token): salah modelnya, bukan akun
    const sebab = j?.choices?.[0]?.finish_reason;
    return hasil({ ok: false, alasan: "sibuk", pesan: `Groq membalas kosong${sebab ? ` (${sebab})` : ""}: modelnya tidak menghasilkan teks`, token });
  }
  const pesan = (j?.error?.message || `Groq ${r.status}`).slice(0, 300);
  return hasil({ ok: false, alasan: golongkanGroq(r.status, pesan, j?.error?.code), pesan, token });
};

// ---------------------------------------------------------------- penemuan model

let cacheGroq: { daftar: string[]; sampai: number } | null = null;
let sedangMemuat: Promise<string[]> | null = null;

/** Bukan model percakapan (suara, moderasi, dll.). */
const BUKAN_CHAT = /whisper|tts|orpheus|playai|guard|embed|safeguard|distil-whisper/i;

/** Isi cache daftar model (dipakai tes). */
export function aturDaftarGroq(daftar: string[] | null) {
  cacheGroq = daftar ? { daftar, sampai: Date.now() + 6 * 3600_000 } : null;
  sedangMemuat = null;
}

/** Daftar dari cache tanpa jaringan; null kalau belum pernah dimuat / sudah kedaluwarsa. */
export function daftarModelGroqCache(): string[] | null {
  return cacheGroq && cacheGroq.sampai > Date.now() ? cacheGroq.daftar : null;
}

/** Model percakapan yang aktif untuk key ini (GET /models), konteks terbesar dulu. Cache 6 jam. Melempar error kalau Groq tidak bisa dihubungi. */
export async function daftarModelGroq(apiKey: string): Promise<string[]> {
  const cache = daftarModelGroqCache();
  if (cache) return cache;
  const r = await fetch(`${API}/models`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`Groq ${r.status}`);
  const j = (await r.json()) as { data?: { id?: string; active?: boolean; context_window?: number }[] };
  const daftar = (j.data ?? [])
    .filter((m) => m.id && m.active !== false && !BUKAN_CHAT.test(m.id) && modelGroqValid(m.id))
    .sort((a, b) => (b.context_window ?? 0) - (a.context_window ?? 0) || (a.id ?? "").localeCompare(b.id ?? ""))
    .map((m) => m.id!);
  cacheGroq = { daftar, sampai: Date.now() + 6 * 3600_000 };
  return daftar;
}

/** Muat/segarkan daftar di latar belakang supaya permintaan chat tidak pernah menunggu jaringan; kegagalan diabaikan. */
export function segarkanDaftarGroq(apiKey: string): void {
  if (sedangMemuat || daftarModelGroqCache()) return;
  sedangMemuat = daftarModelGroq(apiKey).finally(() => {
    sedangMemuat = null;
  });
  sedangMemuat.catch(() => {});
}
