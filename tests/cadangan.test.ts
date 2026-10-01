import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleMessage } from "@/lib/bot/handler";
import { fromWib } from "@/lib/time";
import type { HasilClaude } from "@/lib/ai/claude";
import { golongkanGemini, penjalanGeminiCli } from "@/lib/ai/gemini";
import { aturDaftarModel, golongkanOpenRouter, masalahModel, penjalanOpenRouter } from "@/lib/ai/openrouter";
import { panggilAI, pemakaianHariIni, setPenjalanAI, setPenjalanCadangan, simpanKunciCadangan, simpanTokenAI, statusAI, statusCadangan, tesKoneksiAI, urutanPenyedia } from "@/lib/ai/panggil";
import { setSetting } from "@/lib/services/settings";
import { resetDb } from "./helpers";

const db = new PrismaClient();
const at = (tgl: string, jam = 12, menit = 0) => fromWib(tgl, jam, menit);
const ok = (teks: string): HasilClaude => ({ ok: true, teks, durasiMs: 3, token: { masuk: 10, keluar: 2 } });
const gagal = (alasan: Extract<HasilClaude, { ok: false }>["alasan"]): HasilClaude => ({ ok: false, alasan, pesan: alasan, durasiMs: 3 });
const KUNCI_G = "AIzaSy-kunci-gemini-tes-0123456789";
const KUNCI_O = "sk-or-v1-kunci-openrouter-tes-0123456789";
const tanya = (now: Date) => panggilAI(db, { fitur: "chat_web", system: "s", prompt: "p", now });

let dipanggil: string[] = [];
let jawab: Record<string, () => HasilClaude>;
let pulih: (() => void)[] = [];
beforeEach(async () => {
  await resetDb(db);
  dipanggil = [];
  jawab = { claude: () => ok("claude"), gemini: () => ok("gemini"), openrouter: () => ok("openrouter") };
  pulih = [
    setPenjalanAI(async () => (dipanggil.push("claude"), jawab.claude())),
    setPenjalanCadangan({
      gemini: async (p) => (dipanggil.push(`gemini:${p.model}:${p.apiKey}`), jawab.gemini()),
      openrouter: async (p) => (dipanggil.push(`openrouter:${p.model}`), jawab.openrouter()),
    }),
  ];
});
afterEach(() => {
  pulih.forEach((f) => f());
  aturDaftarModel(null);
});
afterAll(() => db.$disconnect());

async function nyalakanCadangan() {
  await setSetting(db, "ai_gemini_aktif", "1");
  await setSetting(db, "ai_openrouter_aktif", "1");
  await setSetting(db, "ai_openrouter_model", "meta-llama/llama-3.3-70b-instruct:free");
  await simpanKunciCadangan(db, "gemini", KUNCI_G);
  await simpanKunciCadangan(db, "openrouter", KUNCI_O);
}

describe("cadangan otomatis", () => {
  it("default: cadangan mati, hanya Claude", async () => {
    expect(await urutanPenyedia(db)).toEqual(["claude"]);
  });

  it("Claude belum disambungkan → Gemini menjawab; kuota dihitung sekali", async () => {
    await nyalakanCadangan();
    const h = await tanya(at("2026-10-05"));
    expect(h).toMatchObject({ ok: true, teks: "gemini", penyedia: "gemini" });
    expect(dipanggil).toEqual([`gemini:gemini-2.5-flash:${KUNCI_G}`]);
    expect(await db.aiCall.findFirst()).toMatchObject({ penyedia: "gemini", utama: true, status: "ok" });
    expect(await pemakaianHariIni(db, at("2026-10-05", 13))).toBe(1);
  });

  it("Claude kena batas & Gemini juga → OpenRouter; tiga percobaan tetap satu kuota", async () => {
    await simpanTokenAI(db, "sk-ant-oat01-token-tes-yang-cukup-panjang");
    await nyalakanCadangan();
    jawab.claude = () => gagal("limit");
    jawab.gemini = () => gagal("limit");
    const h = await tanya(at("2026-10-05"));
    expect(h).toMatchObject({ ok: true, penyedia: "openrouter" });
    expect(dipanggil.map((x) => x.split(":")[0])).toEqual(["claude", "gemini", "openrouter"]);
    const log = await db.aiCall.findMany({ orderBy: { id: "asc" } });
    expect(log.map((l) => [l.penyedia, l.utama, l.status])).toEqual([
      ["claude", true, "limit"],
      ["gemini", false, "limit"],
      ["openrouter", false, "ok"],
    ]);
    expect(await pemakaianHariIni(db, at("2026-10-05", 13))).toBe(1);
    // Gemini yang kena batas ditahan sebentar: permintaan berikutnya langsung ke OpenRouter
    dipanggil = [];
    await tanya(at("2026-10-05", 12, 5));
    expect(dipanggil.map((x) => x.split(":")[0])).toEqual(["openrouter"]);
  });

  it("urutan bisa dibalik; Claude bisa dimatikan; semua gagal → alasan dari percobaan pertama", async () => {
    await nyalakanCadangan();
    await setSetting(db, "ai_urutan_cadangan", "openrouter,gemini");
    await setSetting(db, "ai_claude_aktif", "0");
    expect(await urutanPenyedia(db)).toEqual(["openrouter", "gemini"]);
    jawab.openrouter = () => gagal("sibuk");
    jawab.gemini = () => gagal("gagal");
    const h = await tanya(at("2026-10-05"));
    expect(h).toMatchObject({ ok: false, alasan: "sibuk", penyedia: "openrouter" });
  });

  it("status: asisten tetap 'siap' kalau Claude mati tapi cadangan siap", async () => {
    expect((await statusAI(db, at("2026-10-05"))).siap).toBe(false);
    await nyalakanCadangan();
    const st = await statusAI(db, at("2026-10-05"));
    expect(st).toMatchObject({ siap: true, claudeSiap: false });
    expect(st.cadangan.map((c) => [c.penyedia, c.siap, c.samaran])).toEqual([
      ["gemini", true, "••••6789"],
      ["openrouter", true, "••••6789"],
    ]);
  });

  it("balasan WhatsApp diberi tanda penyedia cadangan", async () => {
    await nyalakanCadangan();
    jawab.gemini = () => ok(JSON.stringify({ balasan: "Aman kok.", aksi: [], memori: [] }));
    await handleMessage(db, { nomor: "085163544535", text: "masuk 300", now: at("2026-10-04", 10) });
    await handleMessage(db, { nomor: "085163544535", text: "ok", now: at("2026-10-04", 10) });
    const [r] = await handleMessage(db, { nomor: "085163544535", text: "kenapa minggu ini boros?", now: at("2026-10-05") });
    expect(r).toContain("Aman kok.");
    expect(r).toContain("dijawab lewat Gemini");
  });
});

describe("OpenRouter: hanya model gratis", () => {
  it("model berbayar ditolak sebelum ada permintaan jaringan", async () => {
    const h = await penjalanOpenRouter({ system: "s", prompt: "p", model: "openai/gpt-4o", apiKey: KUNCI_O });
    expect(h).toMatchObject({ ok: false, alasan: "gagal" });
    expect(h.ok ? "" : h.pesan).toContain("bukan model gratis");
  });

  it("pengaturan model berbayar tidak bisa dipakai lewat setting langsung", async () => {
    await nyalakanCadangan();
    await setSetting(db, "ai_gemini_aktif", "0");
    await setSetting(db, "ai_openrouter_model", "anthropic/claude-3.5-sonnet");
    const h = await tanya(at("2026-10-05"));
    expect(h.ok).toBe(false);
    expect(dipanggil).toEqual([]);
  });
});

describe("OpenRouter mode otomatis", () => {
  const AGENT = "thinkingmachines/inkling-small:free is only available on agentic harnesses. Try plugging it into a coding agent or productivity app listed on https://openrouter.ai/apps";
  const gagalPesan = (alasan: Extract<HasilClaude, { ok: false }>["alasan"], pesan: string): HasilClaude => ({ ok: false, alasan, pesan, durasiMs: 3 });

  beforeEach(async () => {
    await setSetting(db, "ai_openrouter_aktif", "1");
    await simpanKunciCadangan(db, "openrouter", KUNCI_O);
    aturDaftarModel([
      { id: "deepseek/deepseek-chat:free", nama: "DeepSeek", konteks: 64000, gambar: false },
      { id: "meta-llama/llama-3.3-70b-instruct:free", nama: "Llama", konteks: 128000, gambar: false },
      { id: "google/gemma-3-27b-it:free", nama: "Gemma", konteks: 96000, gambar: true },
    ]);
  });

  it("golongan error: model khusus agent bukan 'token ditolak'", () => {
    expect(golongkanOpenRouter(403, AGENT)).toBe("gagal");
    expect(masalahModel(AGENT)).toBe("rusak");
    expect(golongkanOpenRouter(401, "No auth credentials found")).toBe("belum_login");
    expect(golongkanOpenRouter(429, "Rate limit exceeded: free-models-per-day")).toBe("limit");
    expect(golongkanOpenRouter(429, "deepseek/deepseek-chat:free is temporarily rate-limited upstream")).toBe("sibuk");
    expect(masalahModel("No endpoints found matching your data policy (Free model publication)")).toBeNull();
  });

  it("model yang menolak dilewati, model berikutnya menjawab, dan diingat untuk permintaan berikutnya", async () => {
    let n = 0;
    jawab.openrouter = () => (n++ === 0 ? gagalPesan("gagal", AGENT) : ok("llama"));
    const h = await tesKoneksiAI(db, at("2026-10-05"), "openrouter");
    expect(h.ok).toBe(true);
    expect(dipanggil).toEqual(["openrouter:deepseek/deepseek-chat:free", "openrouter:meta-llama/llama-3.3-70b-instruct:free"]);
    const log = await db.aiCall.findFirst({ where: { penyedia: "openrouter" } });
    expect(log).toMatchObject({ status: "ok", model: "meta-llama/llama-3.3-70b-instruct:free" });
    expect(log?.catatan).toContain("deepseek/deepseek-chat:free");
    const [, o] = await statusCadangan(db);
    expect(o).toMatchObject({ kondisi: "ok", modelTerakhir: "meta-llama/llama-3.3-70b-instruct:free" });

    dipanggil = [];
    jawab.openrouter = () => ok("llama");
    await tesKoneksiAI(db, at("2026-10-05", 13), "openrouter");
    expect(dipanggil).toEqual(["openrouter:meta-llama/llama-3.3-70b-instruct:free"]);
  });

  it("foto hanya ke model yang bisa membaca gambar", async () => {
    const r = await panggilAI(db, { fitur: "struk", system: "s", prompt: "p", gambar: "/tmp/x.jpg", now: at("2026-10-05"), penyedia: "openrouter" });
    expect(r.ok).toBe(true);
    expect(dipanggil).toEqual(["openrouter:google/gemma-3-27b-it:free"]);
  });

  it("masalah akun (privasi/batas harian) tidak mencoba model lain dan tidak menandai model", async () => {
    jawab.openrouter = () => gagalPesan("gagal", "No endpoints found matching your data policy (Free model publication)");
    const h = await tesKoneksiAI(db, at("2026-10-05"), "openrouter");
    expect(h.ok).toBe(false);
    expect(dipanggil).toHaveLength(1);
    expect(await db.setting.findUnique({ where: { kunci: "ai_openrouter_model_buruk" } })).toBeNull();
  });

  it("semua model menolak → berhenti setelah 3 dan pesannya jelas", async () => {
    jawab.openrouter = () => gagalPesan("gagal", AGENT);
    const h = await tesKoneksiAI(db, at("2026-10-05"), "openrouter");
    expect(h.ok).toBe(false);
    expect(dipanggil).toHaveLength(3);
    expect(h.ok ? "" : h.pesan).toContain("sedang tidak bisa dipakai");
  });

  it("model pilihan sendiri tidak diganti diam-diam", async () => {
    await setSetting(db, "ai_openrouter_model", "deepseek/deepseek-chat:free");
    jawab.openrouter = () => gagalPesan("gagal", AGENT);
    await tesKoneksiAI(db, at("2026-10-05"), "openrouter");
    expect(dipanggil).toEqual(["openrouter:deepseek/deepseek-chat:free"]);
  });
});

describe("Gemini CLI", () => {
  it("golongan error", () => {
    expect(golongkanGemini("Please set an Auth method in settings.json or GEMINI_API_KEY, GOOGLE_GENAI_USE_VERTEXAI")).toBe("belum_diatur");
    expect(golongkanGemini("API key not valid. API_KEY_INVALID", 400)).toBe("belum_login");
    expect(golongkanGemini("RESOURCE_EXHAUSTED", 429)).toBe("limit");
    expect(golongkanGemini("The model is overloaded", 503)).toBe("sibuk");
  });

  it("spawn terisolasi: HOME khusus, prompt sistem dari file, tool web/shell mati, prompt lewat stdin", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "dk-gemini-"));
    const lama = { bin: process.env.GEMINI_BIN, home: process.env.GEMINI_HOME };
    process.env.GEMINI_BIN = path.resolve(import.meta.dirname, "fixtures/fake-gemini.mjs");
    process.env.GEMINI_HOME = home;
    process.env.ANTHROPIC_API_KEY = "sk-ant-api-berbayar";
    try {
      const h = await penjalanGeminiCli({ system: "SISTEM-RAHASIA", prompt: "halo gemini", model: "gemini-2.5-flash", apiKey: KUNCI_G });
      expect(h.ok).toBe(true);
      if (!h.ok) return;
      const r = JSON.parse(h.teks);
      expect(r).toMatchObject({ home, sistem: "SISTEM-RAHASIA", apiKey: KUNCI_G, anthropic: null, trust: "true", auth: "gemini-api-key", prompt: "halo gemini" });
      expect(r.args).toEqual(["-p", "", "-o", "json", "-m", "gemini-2.5-flash", "--approval-mode", "plan"]);
      expect(r.args.join(" ")).not.toContain("halo");
      expect(r.tools.exclude).toEqual(expect.arrayContaining(["run_shell_command", "web_fetch", "google_web_search", "write_file"]));
      expect(h.token).toEqual({ masuk: 120, keluar: 30 });
      expect((fs.statSync(path.join(home, ".gemini/settings.json")).mode & 0o777).toString(8)).toBe("600");

      const k = await penjalanGeminiCli({ system: "s", prompt: "MODE:kuota", model: "gemini-2.5-flash", apiKey: KUNCI_G });
      expect(k).toMatchObject({ ok: false, alasan: "limit" });
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
      process.env.GEMINI_BIN = lama.bin;
      process.env.GEMINI_HOME = lama.home;
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
