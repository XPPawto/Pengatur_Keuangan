import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleMessage } from "@/lib/bot/handler";
import { fromWib } from "@/lib/time";
import type { HasilClaude } from "@/lib/ai/claude";
import { golongkanGemini, penjalanGeminiCli } from "@/lib/ai/gemini";
import { penjalanOpenRouter } from "@/lib/ai/openrouter";
import { panggilAI, pemakaianHariIni, setPenjalanAI, setPenjalanCadangan, simpanKunciCadangan, simpanTokenAI, statusAI, urutanPenyedia } from "@/lib/ai/panggil";
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
afterEach(() => pulih.forEach((f) => f()));
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
