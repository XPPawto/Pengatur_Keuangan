import fs from "node:fs";
import type { AlasanGagal, HasilClaude, HasilTanpaDurasi, PanggilanClaude } from "./claude";

/**
 * Cadangan: OpenRouter, HANYA model gratis (id berakhiran ":free"). Model berbayar ditolak sebelum
 * permintaan dikirim, jadi tidak mungkin ada tagihan walau saldo OpenRouter terisi.
 */

const API = "https://openrouter.ai/api/v1";

export type PenjalanOpenRouter = (p: PanggilanClaude & { apiKey: string }) => Promise<HasilClaude>;

export const modelGratis = (id: string) => /^[\w.\-/]+:free$/.test(id);

export interface ModelGratis {
  id: string;
  nama: string;
  konteks: number;
  gambar: boolean;
}

let cacheModel: { daftar: ModelGratis[]; sampai: number } | null = null;

/** Daftar model gratis dari OpenRouter (publik, tanpa API key), di-cache 6 jam. */
export async function daftarModelGratis(): Promise<ModelGratis[]> {
  if (cacheModel && cacheModel.sampai > Date.now()) return cacheModel.daftar;
  const r = await fetch(`${API}/models`, { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`OpenRouter ${r.status}`);
  const j = (await r.json()) as { data?: { id: string; name?: string; context_length?: number; pricing?: Record<string, string>; architecture?: { input_modalities?: string[] } }[] };
  const daftar = (j.data ?? [])
    .filter((m) => modelGratis(m.id) && Object.values(m.pricing ?? {}).every((v) => Number(v) === 0))
    .map((m) => ({ id: m.id, nama: m.name ?? m.id, konteks: m.context_length ?? 0, gambar: !!m.architecture?.input_modalities?.includes("image") }))
    .sort((a, b) => b.konteks - a.konteks);
  cacheModel = { daftar, sampai: Date.now() + 6 * 3600_000 };
  return daftar;
}

export function golongkanOpenRouter(status: number, pesan: string): AlasanGagal {
  if (status === 401 || status === 403) return "belum_login";
  if (status === 429 || /rate.?limit|quota/i.test(pesan)) return "limit";
  if (status >= 500 || status === 408) return "sibuk";
  return "gagal";
}

const MIME: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif" };

export const penjalanOpenRouter: PenjalanOpenRouter = async (p) => {
  const mulai = Date.now();
  const hasil = (h: HasilTanpaDurasi) => ({ ...h, durasiMs: Date.now() - mulai }) as HasilClaude;
  if (!modelGratis(p.model)) return hasil({ ok: false, alasan: "gagal", pesan: `Model "${p.model}" bukan model gratis (harus berakhiran :free). Tidak dikirim.` });

  const isiUser: unknown = p.gambar
    ? [
        { type: "text", text: p.prompt.replace(/\.\/foto[^\s]*/g, "foto terlampir") },
        { type: "image_url", image_url: { url: `data:${MIME[(p.gambar.match(/\.\w+$/)?.[0] ?? ".jpg").toLowerCase()] ?? "image/jpeg"};base64,${fs.readFileSync(p.gambar).toString("base64")}` } },
      ]
    : p.prompt;
  let r: Response;
  try {
    r = await fetch(`${API}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${p.apiKey}`, "Content-Type": "application/json", "X-Title": "DompetKos" },
      body: JSON.stringify({ model: p.model, messages: [{ role: "system", content: p.system }, { role: "user", content: isiUser }], max_tokens: 2000 }),
      signal: AbortSignal.timeout(p.timeoutMs ?? 90_000),
    });
  } catch (e) {
    const timeout = e instanceof Error && e.name === "TimeoutError";
    return hasil({ ok: false, alasan: timeout ? "timeout" : "sibuk", pesan: timeout ? "OpenRouter tidak menjawab tepat waktu" : `Tidak bisa menghubungi OpenRouter: ${e instanceof Error ? e.message : e}` });
  }
  const j = (await r.json().catch(() => null)) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    error?: { message?: string; code?: number };
  } | null;
  const token = j?.usage ? { masuk: Math.round(j.usage.prompt_tokens ?? 0), keluar: Math.round(j.usage.completion_tokens ?? 0) } : undefined;
  const teks = j?.choices?.[0]?.message?.content;
  if (r.ok && !j?.error && typeof teks === "string" && teks.trim()) return hasil({ ok: true, teks, token });
  const pesan = (j?.error?.message || `OpenRouter ${r.status}`).slice(0, 300);
  return hasil({ ok: false, alasan: golongkanOpenRouter(j?.error?.code ?? r.status, pesan), pesan, token });
};
