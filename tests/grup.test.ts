import fs from "node:fs";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HasilClaude } from "@/lib/ai/claude";
import { aturDaftarGemini } from "@/lib/ai/gemini";
import { aturDaftarGroq } from "@/lib/ai/groq";
import { adalahPertanyaan, BANTUAN, bersihkanBalasan, caraKerja, IDENTITAS, NAMA_ASISTEN, pertanyaanTeknis, jawabanGrupHariIni, pertanyaanIdentitas, prosesPesanGrup, resetKeadaanGrup, SYSTEM_EDITOR, SYSTEM_GRUP, tingkatSoal, urutanGiliran } from "@/lib/ai/grup";
import { aturDaftarModel } from "@/lib/ai/openrouter";
import { pemakaianHariIni, setPenjalanAI, setPenjalanCadangan, simpanKunciCadangan, simpanTokenAI } from "@/lib/ai/panggil";
import { dataKoneksi } from "@/lib/services/koneksi";
import { getSetting, setSetting } from "@/lib/services/settings";
import { fromWib } from "@/lib/time";
import type { GatewayDriver, GatewayState, IncomingWaMessage, OpsiKirim, WaMode } from "@/lib/whatsapp/gateway";
import { WaManager } from "@/lib/whatsapp/manager";
import { resetDb } from "./helpers";

const db = new PrismaClient();
const at = (jam: number, menit = 0, detik = 0) => new Date(fromWib("2026-10-05", jam, menit).getTime() + detik * 1000);
const ok = (teks: string): HasilClaude => ({ ok: true, teks, durasiMs: 3 });
const rusak = (): HasilClaude => ({ ok: false, alasan: "belum_login", pesan: "token ditolak", durasiMs: 3 });
const sibuk = (): HasilClaude => ({ ok: false, alasan: "sibuk", pesan: "high demand (UNAVAILABLE)", durasiMs: 3 });

const OWNER = "6285163544535";
const GRUP = "120363000000000001@g.us";
const GRUP_LAIN = "120363000000000002@g.us";
const OR_MODEL = "meta-llama/llama-3.3-70b-instruct:free";

let dipanggil: string[] = [];
let prompts: string[] = [];
let sistem: string[] = [];
/** jalur file gambar yang diterima tiap panggilan penyedia (null = tanpa gambar) dan apakah filenya ada saat dipanggil */
let jalurGambar: (string | null)[] = [];
let gambarAda: (boolean | null)[] = [];
/** model yang diterima tiap penyedia: "claude:haiku", "gemini:gemini-3.6-flash", … */
let modelDipakai: string[] = [];
let jawab: Record<"claude" | "gemini" | "openrouter" | "groq", (prompt: string) => HasilClaude>;
/** penundaan buatan per penyedia (ms), untuk menguji penyedia yang lambat */
let tunda: Record<string, number> = {};
const tahan = (k: string) => (tunda[k] ? new Promise((r) => setTimeout(r, tunda[k])) : null);
let pulih: (() => void)[] = [];

beforeEach(async () => {
  await resetDb(db);
  resetKeadaanGrup();
  aturDaftarGemini(["gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.5-flash", "gemini-3.8-flash"]);
  aturDaftarModel([]);
  dipanggil = [];
  prompts = [];
  sistem = [];
  jalurGambar = [];
  gambarAda = [];
  modelDipakai = [];
  tunda = {};
  jawab = { claude: () => ok("jawaban claude"), gemini: () => ok("jawaban gemini"), openrouter: () => ok("jawaban openrouter"), groq: () => ok("jawaban groq") };
  aturDaftarGroq(["llama-3.3-70b-versatile", "openai/gpt-oss-120b", "openai/gpt-oss-20b", "llama-3.1-8b-instant"]);
  pulih = [
    setPenjalanAI(async (p) => (dipanggil.push("claude"), prompts.push(p.prompt), sistem.push(p.system), jalurGambar.push(p.gambar ?? null), gambarAda.push(p.gambar ? fs.existsSync(p.gambar) : null), modelDipakai.push(`claude:${p.model}`), await tahan("claude"), jawab.claude(p.prompt))),
    setPenjalanCadangan({
      gemini: async (p) => (dipanggil.push("gemini"), prompts.push(p.prompt), sistem.push(p.system), jalurGambar.push(p.gambar ?? null), gambarAda.push(p.gambar ? fs.existsSync(p.gambar) : null), modelDipakai.push(`gemini:${p.model}`), await tahan("gemini"), jawab.gemini(p.prompt)),
      groq: async (p) => (dipanggil.push("groq"), prompts.push(p.prompt), sistem.push(p.system), jalurGambar.push(p.gambar ?? null), gambarAda.push(p.gambar ? fs.existsSync(p.gambar) : null), modelDipakai.push(`groq:${p.model}`), await tahan("groq"), jawab.groq(p.prompt)),
      openrouter: async (p) => (dipanggil.push("openrouter"), prompts.push(p.prompt), sistem.push(p.system), jalurGambar.push(p.gambar ?? null), gambarAda.push(p.gambar ? fs.existsSync(p.gambar) : null), modelDipakai.push(`openrouter:${p.model}`), await tahan("openrouter"), jawab.openrouter(p.prompt)),
    }),
  ];
});
afterEach(() => {
  pulih.forEach((f) => f());
  aturDaftarGroq(null);
  aturDaftarGemini(null);
  aturDaftarModel(null);
});
afterAll(() => db.$disconnect());

/** Sambungkan penyedia & aktifkan grup. `penyedia` = yang tersambung. */
async function siapkan(penyedia: ("claude" | "gemini" | "openrouter" | "groq")[] = ["claude", "gemini", "openrouter"], opsi: { mode?: string; strategi?: "gabung" | "giliran" } = {}) {
  if (penyedia.includes("claude")) await simpanTokenAI(db, "token-claude-tes-0123456789");
  if (penyedia.includes("gemini")) await simpanKunciCadangan(db, "gemini", "AIzaSy-kunci-gemini-tes-0123456789");
  if (penyedia.includes("groq")) await simpanKunciCadangan(db, "groq", "gsk_kunci-groq-tes-0123456789abcdef0123456789");
  if (penyedia.includes("openrouter")) {
    await simpanKunciCadangan(db, "openrouter", "sk-or-v1-kunci-openrouter-tes-0123456789");
    await setSetting(db, "ai_openrouter_model", OR_MODEL);
  }
  await setSetting(db, "grup_ai_jid", GRUP);
  await setSetting(db, "grup_ai_aktif", "1");
  await setSetting(db, "grup_ai_strategi", opsi.strategi ?? "giliran"); // tes lama menguji round robin
  if (opsi.mode) await setSetting(db, "grup_ai_mode", opsi.mode);
}

const kirim = (text: string, o: { jid?: string; nomor?: string; nama?: string; disapa?: boolean; now?: Date } = {}) =>
  prosesPesanGrup(db, { nomor: o.nomor ?? "628111111111", text, waktu: o.now ?? at(12), grup: { jid: o.jid ?? GRUP, nama: o.nama ?? "Budi", disapa: o.disapa ?? false } }, o.now ?? at(12));

describe("deteksi & pembersihan", () => {
  it("adalahPertanyaan: tanda tanya / kata tanya; obrolan biasa bukan", () => {
    for (const t of ["apa itu fotosintesis?", "bagaimana cara masak nasi goreng", "tolong terjemahkan ini ke inggris", "Kenapa langit biru", "can you explain recursion", "ibukota jepang?"]) expect(adalahPertanyaan(t), t).toBe(true);
    for (const t of ["haha iya bener banget", "otw ya", "ok", "mantap gan", ""]) expect(adalahPertanyaan(t), t).toBe(false);
  });

  it("bersihkanBalasan: **tebal** → *tebal*, heading dibuang, dipotong kalau kepanjangan", () => {
    expect(bersihkanBalasan("## Judul\n\n**Penting**: ini\n\n\n\nlagi")).toBe("Judul\n\n*Penting*: ini\n\nlagi");
    const panjang = bersihkanBalasan("a".repeat(5000), 100);
    expect(panjang).toHaveLength(100);
    expect(panjang.endsWith("…")).toBe(true);
  });

  it("urutanGiliran: round robin di antara penyedia yang tersedia", () => {
    const t = ["claude", "gemini", "openrouter"] as const;
    expect([0, 1, 2, 3, 4, 5].map((n) => urutanGiliran(t, n)[0])).toEqual(["claude", "gemini", "openrouter", "claude", "gemini", "openrouter"]);
    expect(urutanGiliran(t, 1)).toEqual(["gemini", "openrouter", "claude"]); // sisanya jadi cadangan berurutan
    expect([0, 1, 2].map((n) => urutanGiliran(["gemini", "openrouter"], n)[0])).toEqual(["gemini", "openrouter", "gemini"]);
    expect(urutanGiliran([], 3)).toEqual([]);
  });
});

describe("pemilihan grup & perintah pemilik", () => {
  it("grup lain & grup belum dipilih: diabaikan total (tidak membalas, tidak memanggil AI, tidak menyimpan)", async () => {
    await siapkan();
    expect(await kirim("/ai halo", { jid: GRUP_LAIN })).toBeNull();
    await setSetting(db, "grup_ai_jid", "");
    expect(await kirim("/ai halo")).toBeNull();
    expect(dipanggil).toEqual([]);
    expect(await db.aiChat.count()).toBe(0);
  });

  it("`!aigrup aktif`: hanya pemilik yang bisa; grup tempat perintah diketik jadi grup AI", async () => {
    await siapkan(["claude", "gemini"]);
    await setSetting(db, "grup_ai_jid", "");
    await setSetting(db, "grup_ai_aktif", "0");
    expect(await kirim("!aigrup aktif", { nomor: "628111111111" })).toBeNull(); // bukan pemilik: tanpa balasan
    expect(await db.setting.findUnique({ where: { kunci: "grup_ai_jid" } })).toMatchObject({ nilai: "" });

    const r = await kirim("!aigrup aktif", { nomor: OWNER, jid: GRUP_LAIN });
    expect(r).toContain("AI grup aktif");
    expect(r).toContain("/ai");
    expect(r).toContain("Claude → Gemini"); // penyedia yang tersambung
    expect(await db.setting.findUnique({ where: { kunci: "grup_ai_jid" } })).toMatchObject({ nilai: GRUP_LAIN });
    expect(await db.setting.findUnique({ where: { kunci: "grup_ai_aktif" } })).toMatchObject({ nilai: "1" });
  });

  it("perintah lain hanya berlaku di grup yang dipilih; mode, mati, status, reset", async () => {
    await siapkan();
    expect(await kirim("!aigrup mati", { nomor: OWNER, jid: GRUP_LAIN })).toBeNull(); // grup lain: tidak berefek
    expect(await db.setting.findUnique({ where: { kunci: "grup_ai_aktif" } })).toMatchObject({ nilai: "1" });

    expect(await kirim("!aigrup mode semua", { nomor: OWNER })).toContain("setiap pesan");
    expect(await kirim("!aigrup mode ngawur", { nomor: OWNER })).toContain("Pakai:");
    expect(await kirim("!aigrup status", { nomor: OWNER })).toContain("mode semua");
    expect(await kirim("!aigrup mode semua", { nomor: "628111111111" })).toBeNull(); // bukan pemilik

    expect(await kirim("!aigrup mati", { nomor: OWNER })).toContain("dimatikan");
    expect(await kirim("/ai halo")).toBeNull(); // sudah mati
    expect(dipanggil).toEqual([]);
  });
});

describe("pemicu /ai", () => {
  it("bawaan: hanya /ai (atau bot di-mention / pesan bot dibalas); pesan lain diabaikan", async () => {
    await siapkan(["claude"]);
    expect(await kirim("apa itu fotosintesis?")).toBeNull(); // pertanyaan tanpa /ai
    expect(await kirim("haha iya")).toBeNull();
    expect(dipanggil).toEqual([]);
    expect(await kirim("/ai apa itu fotosintesis?")).toContain("jawaban claude");
    expect(await kirim("lanjutkan dong", { disapa: true, nomor: "628222222222" })).toContain("jawaban claude");
    expect(dipanggil).toEqual(["claude", "claude"]);
  });

  it("/AI huruf besar & titik dua; teks tanpa awalan yang menyerupai (/aidan) tidak memicu", async () => {
    await siapkan(["claude"]);
    expect(await kirim("/AI: siapa presiden pertama?")).toContain("jawaban claude");
    expect(await kirim("/aidan apa kabar?")).toBeNull();
    expect(prompts[0]).toContain("siapa presiden pertama?");
    expect(prompts[0]).not.toContain("/AI"); // awalan tidak ikut dikirim ke model
  });

  it("/ai tanpa pertanyaan: petunjuk, AI tidak dipanggil", async () => {
    await siapkan(["claude"]);
    expect(await kirim("/ai")).toContain("Tulis pertanyaannya");
    expect(dipanggil).toEqual([]);
  });

  it("mode pertanyaan: pesan berbentuk pertanyaan juga dijawab; mode semua: setiap pesan teks", async () => {
    await siapkan(["claude"], { mode: "pertanyaan" });
    expect(await kirim("apa itu fotosintesis?")).toContain("jawaban claude");
    expect(await kirim("haha iya")).toBeNull();
    await setSetting(db, "grup_ai_mode", "semua");
    expect(await kirim("haha iya bener", { nomor: "628222222222" })).toContain("jawaban claude");
  });
});

describe("round robin antar penyedia", () => {
  it("tiga penyedia bergiliran Claude → Gemini → OpenRouter → Claude …", async () => {
    await siapkan();
    for (let i = 0; i < 6; i++) await kirim(`/ai pertanyaan ke-${i}`, { nomor: `62811000000${i}`, now: at(12, i) });
    expect(dipanggil).toEqual(["claude", "gemini", "openrouter", "claude", "gemini", "openrouter"]);
  });

  it("giliran dilanjutkan setelah bot restart (disimpan di database)", async () => {
    await siapkan();
    await kirim("/ai satu", { nomor: "628111111101" });
    await kirim("/ai dua", { nomor: "628111111102" });
    resetKeadaanGrup(); // simulasi bot restart: memori hilang
    await kirim("/ai tiga", { nomor: "628111111103" });
    expect(dipanggil).toEqual(["claude", "gemini", "openrouter"]);
  });

  it("penyedia yang belum tersambung dilewati dari giliran", async () => {
    await siapkan(["gemini", "openrouter"]);
    for (let i = 0; i < 4; i++) await kirim(`/ai tanya ${i}`, { nomor: `62811000010${i}`, now: at(12, i) });
    expect(dipanggil).toEqual(["gemini", "openrouter", "gemini", "openrouter"]);
  });

  it("jawaban diberi tanda penyedia (bisa dimatikan)", async () => {
    await siapkan(["gemini"]);
    expect(await kirim("/ai halo")).toMatch(/jawaban gemini\n\n_via Gemini · gemini-[\w.-]+_$/);
    await setSetting(db, "grup_ai_tanda", "0");
    expect(await kirim("/ai halo lagi", { nomor: "628222222222" })).toBe("jawaban gemini");
  });

  it("satu penyedia gagal → langsung dicoba penyedia berikutnya dalam giliran yang sama", async () => {
    await siapkan();
    jawab.claude = rusak; // giliran pertama = Claude, tapi tokennya ditolak
    const r = await kirim("/ai halo");
    expect(r).toContain("jawaban gemini");
    expect(dipanggil).toEqual(["claude", "gemini"]);
  });

  it("semua penyedia gagal: satu pesan maaf (tanpa detail teknis), lalu diam 10 menit", async () => {
    await siapkan();
    jawab.claude = rusak;
    jawab.gemini = sibuk;
    jawab.openrouter = sibuk;
    const r = await kirim("/ai halo", { now: at(12, 0) });
    expect(r).toContain("lagi sibuk atau bermasalah");
    expect(r).not.toMatch(/token|UNAVAILABLE|demand/i);
    expect(await kirim("/ai halo lagi", { nomor: "628222222222", now: at(12, 3) })).toBeNull();
    expect(await kirim("/ai halo lagi", { nomor: "628333333333", now: at(12, 11) })).toContain("lagi sibuk"); // sudah > 10 menit
  });

  it("belum ada penyedia tersambung: diberi tahu sekali, AI tidak dipanggil", async () => {
    await siapkan([]);
    expect(await kirim("/ai halo")).toContain("belum ada penyedia AI");
    expect(await kirim("/ai halo", { nomor: "628222222222" })).toBeNull();
    expect(dipanggil).toEqual([]);
  });
});

describe("batas & isolasi", () => {
  it("per orang per menit: lebih dari batas diabaikan (diberi tahu sekali); orang lain & menit berikutnya tidak terkena", async () => {
    await siapkan(["claude"]);
    await setSetting(db, "grup_ai_per_orang_menit", "2");
    expect(await kirim("/ai satu", { now: at(12, 0, 0) })).toContain("jawaban");
    expect(await kirim("/ai dua", { now: at(12, 0, 10) })).toContain("jawaban");
    expect(await kirim("/ai tiga", { now: at(12, 0, 20) })).toContain("Pelan-pelan ya Budi");
    expect(await kirim("/ai empat", { now: at(12, 0, 30) })).toBeNull(); // pemberitahuan hanya sekali
    expect(await kirim("/ai orang lain", { nomor: "628999999999", nama: "Siti", now: at(12, 0, 40) })).toContain("jawaban");
    expect(await kirim("/ai lima", { now: at(12, 1, 30) })).toContain("jawaban"); // jendela 60 detik sudah lewat
    expect(dipanggil).toHaveLength(4);
  });

  it("batas harian grup: diberi tahu sekali, dan jatah AI pemilik tidak terpakai", async () => {
    await siapkan(["claude"]);
    await setSetting(db, "grup_ai_batas_harian", "2");
    await kirim("/ai satu", { nomor: "628111111111", now: at(12, 0) });
    await kirim("/ai dua", { nomor: "628222222222", now: at(12, 1) });
    expect(await kirim("/ai tiga", { nomor: "628333333333", now: at(12, 2) })).toContain("Jatah AI grup hari ini (2 pertanyaan) sudah habis");
    expect(await kirim("/ai empat", { nomor: "628444444444", now: at(12, 3) })).toBeNull();
    expect(dipanggil).toHaveLength(2);
    expect(await pemakaianHariIni(db, at(13))).toBe(0); // jatah pemilik (fitur lain) tidak berkurang
    expect(await db.aiCall.count({ where: { fitur: "chat_grup" } })).toBe(2);
  });

  it("tidak ada data DompetKos di prompt maupun instruksi; AI tidak punya aksi", async () => {
    await siapkan(["claude"]);
    await db.setting.upsert({ where: { kunci: "nama_pengguna" }, update: { nilai: "Abdul" }, create: { kunci: "nama_pengguna", nilai: "Abdul" } });
    await kirim("/ai berapa saldo amplop makan gw?");
    expect(sistem[0]).not.toMatch(/DompetKos|amplop|Rp\d|saldo:/i);
    expect(sistem[0]).toContain("Jangan membahas aplikasi keuangan");
    expect(prompts[0]).not.toMatch(/<DATA>|DompetKos|Abdul/);
    expect(prompts[0]).toContain("# Pesan baru dari Budi");
  });

  it("ingatan pendek: pertanyaan berikutnya membawa percakapan sebelumnya; reset menghapusnya", async () => {
    await siapkan(["claude"]);
    jawab.claude = () => ok("**Paris** ibukota Prancis");
    await kirim("/ai ibukota prancis?", { now: at(12, 0) });
    await kirim("/ai penduduknya berapa?", { now: at(12, 1) });
    expect(prompts[1]).toContain("# Percakapan terakhir di grup");
    expect(prompts[1]).toContain("Budi: ibukota prancis?");
    expect(prompts[1]).toContain("Asisten: *Paris* ibukota Prancis");
    expect(await kirim("!aigrup reset", { nomor: OWNER, now: at(12, 2) })).toContain("dihapus");
    await kirim("/ai halo", { now: at(12, 3) });
    expect(prompts[2]).not.toContain("# Percakapan terakhir");
  });
});

/** Driver WhatsApp tiruan: mencatat kiriman, termasuk tujuan & kutipan. */
class FakeDriver implements GatewayDriver {
  sent: { tujuan: string; text: string; kutip?: unknown }[] = [];
  mengetikKe: string[] = [];
  private msgH: (m: IncomingWaMessage) => void | Promise<void> = () => {};
  onState(_: (s: GatewayState) => void) {}
  onMessage(h: (m: IncomingWaMessage) => void | Promise<void>) {
    this.msgH = h;
  }
  async start(_: WaMode) {}
  async stop() {}
  async logout() {}
  hasSession() {
    return false;
  }
  async sendMessage(tujuan: string, text: string, opsi?: OpsiKirim) {
    this.sent.push({ tujuan, text, kutip: opsi?.kutip });
  }
  async mengetik(tujuan: string) {
    this.mengetikKe.push(tujuan);
  }
  terima(m: IncomingWaMessage) {
    return this.msgH(m);
  }
}

describe("lewat WaManager (driver tiruan)", () => {
  it("pesan grup dibalas ke grup (dengan kutipan) dan tidak pernah masuk ke bot DompetKos", async () => {
    await siapkan(["claude"]);
    const driver = new FakeDriver();
    const mgr = new WaManager(db, driver, { log: () => {} });
    await mgr.init();
    const asli = { id: "PESAN-ASLI" };

    await driver.terima({ nomor: "628111111111", text: "/ai halo", waktu: new Date(), grup: { jid: GRUP, nama: "Budi", disapa: false, pesan: asli } });
    expect(driver.sent).toHaveLength(1);
    expect(driver.sent[0]).toMatchObject({ tujuan: GRUP, kutip: asli });
    expect(driver.sent[0].text).toContain("jawaban claude");
    expect(driver.mengetikKe).toEqual([GRUP]);

    // pemilik mengetik perintah DompetKos DI GRUP: tidak diproses sebagai catatan keuangan & tidak dijawab
    driver.sent = [];
    await driver.terima({ nomor: OWNER, text: "masuk 300", waktu: new Date(), grup: { jid: GRUP, nama: "Owner", disapa: false } });
    await driver.terima({ nomor: OWNER, text: "tempe 5k", waktu: new Date(), grup: { jid: GRUP, nama: "Owner", disapa: false } });
    expect(driver.sent).toEqual([]);
    expect(await db.pendingAction.count()).toBe(0);
    expect(await db.transaction.count()).toBe(0);

    // grup lain tidak dijawab sama sekali
    await driver.terima({ nomor: "628111111111", text: "/ai halo", waktu: new Date(), grup: { jid: GRUP_LAIN, nama: "Budi", disapa: false } });
    expect(driver.sent).toEqual([]);
  });

  it("chat pribadi tetap lewat bot DompetKos seperti biasa", async () => {
    await siapkan(["claude"]);
    const driver = new FakeDriver();
    const mgr = new WaManager(db, driver, { log: () => {} });
    await mgr.init();
    await driver.terima({ nomor: OWNER, text: "masuk 300", waktu: new Date() });
    expect(driver.sent.length).toBeGreaterThan(0);
    expect(driver.sent[0].tujuan).toBe(OWNER);
    expect(await db.pendingAction.count()).toBe(1);
  });
});

describe("peta Koneksi: jalur AI grup & giliran round robin", () => {
  it("grup belum dipilih / mati: tidak ada penyedia bergiliran yang ditandai aktif", async () => {
    await siapkan();
    await setSetting(db, "grup_ai_jid", "");
    const k = await dataKoneksi(db, at(12));
    expect(k.grup).toMatchObject({ dipilih: false, aktif: false, hariIni: 0 });
    await setSetting(db, "grup_ai_jid", GRUP);
    await setSetting(db, "grup_ai_aktif", "0");
    expect((await dataKoneksi(db, at(12))).grup).toMatchObject({ dipilih: true, aktif: false });
  });

  it("roda berisi penyedia yang tersambung; 'berikut' maju tiap jawaban; jumlah per penyedia dihitung", async () => {
    await siapkan();
    let k = await dataKoneksi(db, at(12));
    expect(k.grup).toMatchObject({ dipilih: true, aktif: true, roda: ["claude", "gemini", "openrouter"], berikut: "claude", hariIni: 0 });

    await kirim("/ai satu", { nomor: "628111111101", now: at(12, 1) }); // Claude
    k = await dataKoneksi(db, at(12, 2));
    expect(k.grup.berikut).toBe("gemini");
    await kirim("/ai dua", { nomor: "628111111102", now: at(12, 2) }); // Gemini
    await kirim("/ai tiga", { nomor: "628111111103", now: at(12, 3) }); // OpenRouter
    await kirim("/ai empat", { nomor: "628111111104", now: at(12, 4) }); // Claude lagi
    k = await dataKoneksi(db, at(12, 5));
    expect(k.grup).toMatchObject({ berikut: "gemini", hariIni: 4, per: { claude: 2, gemini: 1, openrouter: 1 } });
    // jawaban grup tidak dihitung ke fitur-fitur DompetKos di peta
    expect(k.fitur.every((f) => f.kode !== ("chat_grup" as string))).toBe(true);
  });

  it("penyedia yang belum tersambung tidak ikut roda", async () => {
    await siapkan(["gemini", "openrouter"]);
    const k = await dataKoneksi(db, at(12));
    expect(k.grup.roda).toEqual(["gemini", "openrouter"]);
    expect(k.grup.berikut).toBe("gemini");
  });
});

describe("ala Meta AI: bantuan, pesan yang dibalas, dan foto", () => {
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
  const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
  const lengkap = (text: string, o: { nomor?: string; gambar?: () => Promise<Buffer>; kutipan?: { teks: string; dariBot: boolean; gambar?: () => Promise<Buffer> }; now?: Date } = {}) =>
    prosesPesanGrup(db, { nomor: o.nomor ?? "628111111111", text, waktu: o.now ?? at(12), gambar: o.gambar, grup: { jid: GRUP, nama: "Budi", disapa: false, kutipan: o.kutipan } }, o.now ?? at(12));

  it("/ai bantuan: daftar kemampuan & batas, tanpa memanggil AI dan tanpa memakai jatah", async () => {
    await siapkan(["claude"]);
    for (let i = 0; i < 6; i++) expect(await kirim(i % 2 ? "/ai bantuan" : "/ai help")).toBe(BANTUAN); // lewat batas 3/menit pun tetap dijawab
    expect(BANTUAN).toContain("Balas pesan");
    expect(BANTUAN).toContain("Kirim foto");
    expect(BANTUAN).toMatch(/Belum bisa:.*internet.*gambar/);
    expect(dipanggil).toEqual([]);
    expect(await db.aiCall.count()).toBe(0);
  });

  it("persona: jujur soal batas (tanpa internet, tanpa bikin gambar), bisa baca foto & pesan yang dibalas", () => {
    expect(SYSTEM_GRUP).toContain("TIDAK bisa membuka internet");
    expect(SYSTEM_GRUP).toContain("TIDAK bisa membuat gambar");
    expect(SYSTEM_GRUP).toContain("Pesan yang dibalas");
    expect(SYSTEM_GRUP).not.toMatch(/DompetKos/i);
  });

  it("membalas pesan lalu /ai: pesan yang dibalas ikut ke prompt; /ai saja menanggapi pesan itu", async () => {
    await siapkan(["claude"]);
    await lengkap("/ai terjemahkan ke Inggris", { kutipan: { teks: "Selamat pagi, semoga harimu menyenangkan", dariBot: false } });
    expect(prompts[0]).toContain("# Pesan yang dibalas (dari anggota grup)");
    expect(prompts[0]).toContain("Selamat pagi, semoga harimu menyenangkan");
    expect(prompts[0]).toMatch(/# Pesan baru dari Budi\nterjemahkan ke Inggris/);

    await lengkap("/ai", { nomor: "628222222222", kutipan: { teks: "Apa itu blockchain?", dariBot: true } });
    expect(prompts[1]).toContain("# Pesan yang dibalas (dari asisten)");
    expect(prompts[1]).toContain("Tanggapi atau jelaskan pesan yang dibalas ini.");
    // tanpa pesan yang dibalas: bagian itu tidak ada
    await lengkap("/ai halo", { nomor: "628333333333" });
    expect(prompts[2]).not.toContain("# Pesan yang dibalas");
  });

  it("foto + /ai: file gambar dikirim ke penyedia (ada saat dipanggil), prompt menyebut file, dan dihapus sesudahnya", async () => {
    await siapkan(["claude"]);
    const r = await lengkap("/ai ini tanaman apa?", { gambar: async () => PNG });
    expect(r).toContain("jawaban claude");
    expect(gambarAda).toEqual([true]);
    expect(jalurGambar[0]).toMatch(/foto\.png$/);
    expect(prompts[0]).toContain("Gambar terlampir: ./foto.png");
    expect(prompts[0]).toContain("ini tanaman apa?");
    expect(fs.existsSync(jalurGambar[0]!)).toBe(false); // sudah dibersihkan
    expect(fs.existsSync(jalurGambar[0]!.replace(/\/foto\.png$/, ""))).toBe(false);
    expect((await db.aiChat.findMany({ where: { peran: "user" } }))[0].isi).toContain("[mengirim foto]");
  });

  it("membalas sebuah foto dengan /ai (tanpa teks): foto yang dibalas dibaca; foto sendiri didahulukan kalau dua-duanya ada", async () => {
    await siapkan(["claude"]);
    await lengkap("/ai", { kutipan: { teks: "", dariBot: false, gambar: async () => JPG } });
    expect(jalurGambar[0]).toMatch(/foto\.jpg$/);
    expect(prompts[0]).toContain("Jelaskan apa yang ada di gambar ini.");

    await lengkap("/ai bandingkan", { nomor: "628222222222", gambar: async () => PNG, kutipan: { teks: "", dariBot: false, gambar: async () => JPG } });
    expect(jalurGambar[1]).toMatch(/foto\.png$/);
  });

  it("foto: OpenRouter dengan model terpasang (bisa teks saja) tidak ikut bergiliran; Claude/Gemini bergantian", async () => {
    await siapkan(); // OpenRouter terpasang dengan model pilihan
    for (let i = 0; i < 4; i++) await lengkap(`/ai foto ${i}`, { nomor: `62811000020${i}`, now: at(12, i), gambar: async () => PNG });
    expect(dipanggil).toEqual(["claude", "gemini", "claude", "gemini"]);
    expect(dipanggil).not.toContain("openrouter");
  });

  it("foto: kalau hanya OpenRouter bermodel terpasang yang tersambung, diberi tahu (tanpa memanggil AI)", async () => {
    await siapkan(["openrouter"]);
    expect(await lengkap("/ai ini apa?", { gambar: async () => PNG })).toContain("Belum ada penyedia yang bisa membaca foto");
    expect(dipanggil).toEqual([]);
  });

  it("foto rusak / bukan gambar / gagal diunduh: pesan ramah, AI tidak dipanggil, tidak ada file tertinggal", async () => {
    await siapkan(["claude"]);
    expect(await lengkap("/ai apa ini?", { gambar: async () => Buffer.from("bukan gambar sama sekali, hanya teks biasa") })).toContain("nggak bisa kubaca");
    expect(await lengkap("/ai apa ini?", { nomor: "628222222222", gambar: async () => { throw new Error("jaringan putus"); } })).toContain("gagal diunduh");
    expect(await lengkap("/ai apa ini?", { nomor: "628333333333", gambar: async () => Buffer.alloc(9 * 1024 * 1024, 0xff) })).toContain("nggak bisa kubaca"); // > 8 MB
    expect(dipanggil).toEqual([]);
  });

  it("file foto dihapus juga kalau semua penyedia gagal", async () => {
    await siapkan(["claude"]);
    jawab.claude = rusak;
    const r = await lengkap("/ai apa ini?", { gambar: async () => PNG });
    expect(r).toContain("lagi sibuk atau bermasalah");
    expect(fs.existsSync(jalurGambar[0]!)).toBe(false);
  });
});

describe("tanpa batas pertanyaan (bawaan)", () => {
  it("satu orang bisa bertanya berkali-kali dalam semenit tanpa dibatasi", async () => {
    await siapkan(["claude"]);
    for (let i = 0; i < 12; i++) {
      const r = await kirim(`/ai pertanyaan ke-${i}`, { now: at(12, 0, i) }); // 12 pertanyaan dalam 12 detik, orang yang sama
      expect(r, `ke-${i}`).toContain("jawaban claude");
    }
    expect(dipanggil).toHaveLength(12);
  });

  it("tidak ada batas harian: tetap dijawab walau sudah ratusan jawaban hari ini", async () => {
    await siapkan(["claude"]);
    await db.aiCall.createMany({ data: Array.from({ length: 400 }, (_, i) => ({ waktu: at(11, 0, i), fitur: "chat_grup", penyedia: "claude", utama: true, model: "sonnet", status: "ok" })) });
    expect(await kirim("/ai masih bisa?", { now: at(12) })).toContain("jawaban claude");
    expect(await kirim("!aigrup status", { nomor: OWNER, now: at(12, 1) })).toContain("tanpa batas");
  });

  it("batas tetap bisa dipasang kalau diinginkan (angka > 0), dan 0 mematikannya lagi", async () => {
    await siapkan(["claude"]);
    await setSetting(db, "grup_ai_per_orang_menit", "1");
    expect(await kirim("/ai satu", { now: at(12, 0, 0) })).toContain("jawaban");
    expect(await kirim("/ai dua", { now: at(12, 0, 5) })).toContain("Pelan-pelan");
    await setSetting(db, "grup_ai_per_orang_menit", "0");
    expect(await kirim("/ai tiga", { now: at(12, 0, 10) })).toContain("jawaban");
  });
});

describe("identitas: ChadGPT 6-Astrea", () => {
  it("pertanyaan identitas dijawab langsung 'ChadGPT 6-Astrea' tanpa memanggil AI dan tanpa memakai jatah", async () => {
    await siapkan(["claude", "gemini"]);
    await setSetting(db, "grup_ai_per_orang_menit", "1"); // jatah ketat pun tidak terpakai oleh pertanyaan identitas
    for (const t of ["ai apa?", "AI apa ini", "model apa", "model apa ini?", "kamu ai apa", "kamu siapa", "siapa kamu?", "siapa namamu", "nama kamu siapa", "bot apa sih", "ai ini apa", "who are you", "which AI are you"]) {
      const r = await kirim(`/ai ${t}`);
      expect(r, t).toBe(IDENTITAS);
    }
    expect(IDENTITAS).toContain("ChadGPT 6-Astrea");
    expect(NAMA_ASISTEN).toBe("ChadGPT 6-Astrea");
    expect(IDENTITAS).toContain("cara kerjamu"); // jalan masuk ke penjelasan teknis
    expect(dipanggil).toEqual([]);
    expect(await db.aiCall.count()).toBe(0);
  });

  it("hanya pertanyaan identitas yang tertangkap; pertanyaan sungguhan tetap ke AI", async () => {
    expect(pertanyaanIdentitas("ai apa yang paling bagus untuk belajar coding?")).toBe(false);
    expect(pertanyaanIdentitas("model apa yang cocok buat mobil listrik")).toBe(false);
    expect(pertanyaanIdentitas("siapa presiden pertama indonesia")).toBe(false);
    expect(pertanyaanIdentitas("apa itu ai")).toBe(false);
    await siapkan(["claude"]);
    expect(await kirim("/ai siapa presiden pertama indonesia?")).toContain("jawaban claude");
    expect(dipanggil).toEqual(["claude"]);
  });

  it("instruksi sistem: nama ChadGPT 6-Astrea, tidak mengaku manusia, menjawab cara kerja dari fakta, tidak membocorkan rahasia", () => {
    expect(SYSTEM_GRUP).toContain("*ChadGPT 6-Astrea*");
    expect(SYSTEM_GRUP).not.toContain("Fable");
    expect(SYSTEM_GRUP).toContain("Jangan pernah mengaku manusia");
    expect(SYSTEM_GRUP).toContain("jawab LENGKAP, jujur, dan akurat");
    expect(SYSTEM_GRUP).toContain("Fakta cara kerja");
    expect(SYSTEM_GRUP).toContain("kunci API, token, nomor telepon");
    expect(SYSTEM_GRUP).not.toContain("JANGAN menceritakan cara kerja internalmu");
    expect(SYSTEM_GRUP).not.toMatch(/bergiliran oleh beberapa penyedia/i);
    expect(SYSTEM_EDITOR).not.toContain("tidak menceritakan cara kerja internal");
  });

  it("mengirim foto dengan 'ai apa?' bukan pertanyaan identitas (itu tentang fotonya)", async () => {
    await siapkan(["claude"]);
    const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
    const r = await prosesPesanGrup(db, { nomor: "628111111111", text: "/ai ini apa?", waktu: at(12), gambar: async () => PNG, grup: { jid: GRUP, nama: "Budi", disapa: false } }, at(12));
    expect(r).toContain("jawaban claude");
  });
});

describe("model Claude sesuai beratnya soal (Haiku / Sonnet / Opus)", () => {
  it("tingkatSoal: ringan, berat (kuliah/koding/foto), sangat berat", () => {
    for (const t of ["halo apa kabar?", "rekomendasi tempat makan enak di bandung", "kapan hari kemerdekaan indonesia?", "artinya serendipity apa?"]) expect(tingkatSoal(t), t).toBe("ringan");
    for (const t of ["jelaskan integral parsial beserta contohnya", "kenapa kode python saya error TypeError: unsupported operand", "tolong kerjakan soal statistik ini", "bantu bikin makalah tentang ekonomi digital", "const x = () => 1; kenapa error?"]) expect(tingkatSoal(t), t).toBe("berat");
    expect(tingkatSoal("ini apa?", { gambar: true })).toBe("berat");
    for (const t of ["buktikan teorema pythagoras secara formal", "rancang arsitektur sistem untuk aplikasi ojek online", "analisis mendalam dampak AI ke pasar kerja"]) expect(tingkatSoal(t), t).toBe("sangat_berat");
    expect(tingkatSoal("a ".repeat(700))).toBe("sangat_berat"); // teks sangat panjang
    expect(tingkatSoal("perbaiki kode ini", { kutipan: `function hitung(x) {\n${"  return x * 2;\n".repeat(50)}}` })).toBe("sangat_berat"); // kode panjang di pesan yang dibalas
  });

  it("giliran Claude memakai haiku / sonnet / opus sesuai soal, dan modelnya tertera di bawah jawaban", async () => {
    await siapkan(["claude"]);
    const a = await kirim("/ai halo apa kabar?", { nomor: "628111111101" });
    await kirim("/ai jelaskan integral parsial", { nomor: "628111111102" });
    await kirim("/ai buktikan teorema pythagoras secara formal", { nomor: "628111111103" });
    expect(modelDipakai).toEqual(["claude:haiku", "claude:sonnet", "claude:opus"]);
    expect(a).toContain("_via Claude · haiku_");
  });

  it("Opus turun ke Sonnet kalau kuota langganan Claude sudah tinggi", async () => {
    await siapkan(["claude"]);
    const reset = Math.round(at(17).getTime() / 1000);
    await db.setting.upsert({
      where: { kunci: "ai_batas_claude" },
      update: { nilai: JSON.stringify({ jendela: { five_hour: { persen: 75, resetsAt: reset, diperbarui: at(11).toISOString() } }, status: "allowed" }) },
      create: { kunci: "ai_batas_claude", nilai: JSON.stringify({ jendela: { five_hour: { persen: 75, resetsAt: reset, diperbarui: at(11).toISOString() } }, status: "allowed" }) },
    });
    await kirim("/ai buktikan teorema pythagoras secara formal");
    expect(modelDipakai).toEqual(["claude:sonnet"]);
  });

  it("pilihan tetap di pengaturan: selalu Sonnet, atau ikuti model halaman Asisten", async () => {
    await siapkan(["claude"]);
    await setSetting(db, "grup_ai_model_claude", "sonnet");
    await kirim("/ai halo", { nomor: "628111111101" });
    await setSetting(db, "grup_ai_model_claude", "bawaan");
    await kirim("/ai halo lagi", { nomor: "628111111102" });
    expect(modelDipakai).toEqual(["claude:sonnet", `claude:${await getSetting(db, "ai_model")}`]);
    expect(await kirim("!aigrup status", { nomor: OWNER })).toContain("Model Claude: bawaan");
  });

  it("Gemini/OpenRouter tidak dipaksa memakai nama model Claude", async () => {
    await siapkan(["gemini"]);
    await kirim("/ai buktikan teorema pythagoras secara formal");
    expect(modelDipakai).toHaveLength(1);
    expect(modelDipakai[0]).toMatch(/^gemini:gemini-/);
  });
});

describe("jawaban gabungan: semua penyedia sekaligus, disatukan jadi yang terbaik", () => {
  const adaGabungan = (pr: string) => pr.includes("## Jawaban A");
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
  /** draf biasa; panggilan penggabungan dijawab "FINAL …" */
  const pasang = () => {
    jawab.claude = (pr) => (adaGabungan(pr) ? ok("FINAL dari claude") : ok("draf claude"));
    jawab.gemini = (pr) => (adaGabungan(pr) ? ok("FINAL dari gemini") : ok("draf gemini"));
    jawab.openrouter = (pr) => (adaGabungan(pr) ? ok("FINAL dari openrouter") : ok("draf openrouter"));
  };
  const promptGabungan = () => prompts.find(adaGabungan) ?? "";

  it("tiap pertanyaan dikirim ke semua penyedia, lalu satu panggilan penggabungan menghasilkan jawaban final", async () => {
    await siapkan(undefined, { strategi: "gabung" });
    pasang();
    const r = await kirim("/ai apa ibukota prancis?");
    expect(r).toContain("FINAL dari gemini");
    expect(dipanggil.slice(0, 3).sort()).toEqual(["claude", "gemini", "openrouter"]); // tiga draf (sekaligus)
    expect(dipanggil).toHaveLength(4);
    expect(dipanggil[3]).toBe("gemini"); // penggabungan oleh Gemini: cepat, gratis, tanpa kuota Claude
    const g = promptGabungan();
    for (const d of ["draf claude", "draf gemini", "draf openrouter", "apa ibukota prancis?", "# Pesan baru dari Budi"]) expect(g, d).toContain(d);
    expect(g).toMatch(/## Jawaban A\ndraf claude[\s\S]*## Jawaban B\ndraf gemini[\s\S]*## Jawaban C\ndraf openrouter/); // urutan tetap
    expect(sistem[3]).toContain(SYSTEM_EDITOR.trim().slice(0, 40));
    expect(sistem[3]).toContain("editor jawaban");
    expect(await jawabanGrupHariIni(db, at(12))).toBe(1); // satu pertanyaan = satu jawaban, bukan empat panggilan
  });

  it("penyedia dan model yang ikut tertera di bawah jawaban (bisa dimatikan)", async () => {
    await siapkan(undefined, { strategi: "gabung" });
    pasang();
    const r = await kirim("/ai halo");
    expect(r).toMatch(/_digabung dari Claude · haiku, Gemini · gemini-[\w.-]+, OpenRouter · llama-3\.3-70b-instruct_$/);
    await setSetting(db, "grup_ai_tanda", "0");
    expect(await kirim("/ai halo lagi", { nomor: "628222222222" })).toBe("FINAL dari gemini");
  });

  it("hanya satu penyedia yang menjawab: dipakai langsung, tanpa tahap penggabungan", async () => {
    await siapkan(undefined, { strategi: "gabung" });
    jawab.claude = rusak;
    jawab.gemini = sibuk;
    jawab.openrouter = () => ok("draf openrouter");
    const r = await kirim("/ai halo");
    expect(r).toMatch(/^draf openrouter\n\n_via OpenRouter · llama-3\.3-70b-instruct_$/);
    expect(prompts.some(adaGabungan)).toBe(false);
  });

  it("semua penyedia gagal: satu pesan maaf (tanpa detail teknis), lalu diam", async () => {
    await siapkan(undefined, { strategi: "gabung" });
    jawab.claude = rusak;
    jawab.gemini = sibuk;
    jawab.openrouter = sibuk;
    const r = await kirim("/ai halo", { now: at(12, 0) });
    expect(r).toContain("lagi sibuk atau bermasalah");
    expect(r).not.toMatch(/token|UNAVAILABLE|demand/i);
    expect(await kirim("/ai halo lagi", { nomor: "628222222222", now: at(12, 3) })).toBeNull();
    expect(await jawabanGrupHariIni(db, at(12))).toBe(0); // gagal tidak dihitung sebagai jawaban
  });

  it("penggabungan gagal di semua penyedia: dipakai draf terbaik (urutan Claude, Gemini, OpenRouter)", async () => {
    await siapkan(undefined, { strategi: "gabung" });
    jawab.claude = (pr) => (adaGabungan(pr) ? rusak() : ok("draf claude"));
    jawab.gemini = (pr) => (adaGabungan(pr) ? sibuk() : ok("draf gemini"));
    jawab.openrouter = (pr) => (adaGabungan(pr) ? sibuk() : ok("draf openrouter"));
    const r = await kirim("/ai halo");
    expect(r).toMatch(/^draf claude\n\n_via Claude/);
  });

  it("penyedia yang lambat tidak ditunggu terus: setelah draf pertama + waktu tenggang, yang lain ditinggal", async () => {
    await siapkan(undefined, { strategi: "gabung" });
    pasang();
    tunda.openrouter = 2000;
    const r = await prosesPesanGrup(db, { nomor: "628111111111", text: "/ai halo", waktu: at(12), grup: { jid: GRUP, nama: "Budi", disapa: false } }, at(12), { tenggang: 600 });
    expect(r).toMatch(/_digabung dari Claude · haiku, Gemini · gemini-[\w.-]+_$/); // OpenRouter tidak ikut
    expect(promptGabungan()).not.toContain("draf openrouter");
    await new Promise((r2) => setTimeout(r2, 2500)); // biarkan panggilan yang tertinggal selesai sebelum tes berikutnya mereset database
  });

  it("soal sangat berat: Claude yang menggabungkan; kalau kuota langganannya tinggi, Gemini", async () => {
    await siapkan(undefined, { strategi: "gabung" });
    pasang();
    const r1 = await kirim("/ai buktikan teorema pythagoras secara formal", { nomor: "628111111101", now: at(12, 0) });
    expect(r1).toContain("FINAL dari claude");
    expect(dipanggil[3]).toBe("claude");

    dipanggil = [];
    const reset = Math.round(at(17).getTime() / 1000);
    const nilai = JSON.stringify({ jendela: { five_hour: { persen: 75, resetsAt: reset, diperbarui: at(11).toISOString() } }, status: "allowed" });
    await db.setting.upsert({ where: { kunci: "ai_batas_claude" }, update: { nilai }, create: { kunci: "ai_batas_claude", nilai } });
    const r2 = await kirim("/ai buktikan teorema limit secara formal", { nomor: "628111111102", now: at(12, 1) });
    expect(r2).toContain("FINAL dari gemini");
    expect(dipanggil.filter((x) => x === "claude")).toHaveLength(1); // Claude hanya membuat draf
  });

  it("foto: draf melihat gambar, tahap penggabungan tidak (hanya membaca draf), file dihapus", async () => {
    await siapkan(["claude", "gemini"], { strategi: "gabung" });
    pasang();
    const r = await prosesPesanGrup(db, { nomor: "628111111111", text: "/ai ini apa?", waktu: at(12), gambar: async () => PNG, grup: { jid: GRUP, nama: "Budi", disapa: false } }, at(12));
    expect(r).toContain("FINAL");
    expect(gambarAda.slice(0, 2)).toEqual([true, true]); // dua draf membaca gambar
    expect(gambarAda[2]).toBeNull(); // penggabungan tanpa gambar
    expect(promptGabungan()).not.toContain("Gambar terlampir");
    expect(promptGabungan()).toContain("sudah melihatnya");
    expect(fs.existsSync(jalurGambar[0]!)).toBe(false);
  });

  it("satu penyedia saja yang tersambung: langsung dijawab, tidak ada penggabungan", async () => {
    await siapkan(["claude"], { strategi: "gabung" });
    pasang();
    expect(await kirim("/ai halo")).toContain("draf claude");
    expect(dipanggil).toEqual(["claude"]);
  });

  it("batas harian dihitung per pertanyaan (bukan per panggilan) dan tahan `!aigrup reset`", async () => {
    await siapkan(undefined, { strategi: "gabung" });
    pasang();
    await setSetting(db, "grup_ai_batas_harian", "2");
    await kirim("/ai satu", { nomor: "628111111101", now: at(12, 0) });
    await kirim("/ai dua", { nomor: "628111111102", now: at(12, 1) }); // 8 panggilan, tapi baru 2 jawaban
    await kirim("!aigrup reset", { nomor: OWNER, now: at(12, 2) });
    expect(await kirim("/ai tiga", { nomor: "628111111103", now: at(12, 3) })).toContain("Jatah AI grup hari ini (2 pertanyaan) sudah habis");
  });

  it("`!aigrup strategi`: pemilik bisa pindah antara gabungan dan bergiliran; status menunjukkannya", async () => {
    await siapkan(undefined, { strategi: "gabung" });
    pasang();
    expect(await kirim("!aigrup status", { nomor: OWNER })).toContain("gabungan semua penyedia");
    expect(await kirim("!aigrup strategi giliran", { nomor: OWNER })).toContain("bergiliran");
    expect(await kirim("!aigrup strategi ngawur", { nomor: OWNER })).toContain("Pakai:");
    expect(await kirim("!aigrup strategi gabung", { nomor: "628111111111" })).toBeNull(); // bukan pemilik
    await kirim("/ai satu", { nomor: "628111111101", now: at(12, 0) });
    await kirim("/ai dua", { nomor: "628111111102", now: at(12, 1) });
    expect(dipanggil).toEqual(["claude", "gemini"]); // bergiliran: satu penyedia per pertanyaan
    expect(await kirim("!aigrup strategi gabung", { nomor: OWNER, now: at(12, 2) })).toContain("digabung");
  });

  it("peta Koneksi: mode gabungan tidak punya 'giliran berikut'; jawaban dihitung per pertanyaan", async () => {
    await siapkan(undefined, { strategi: "gabung" });
    pasang();
    await kirim("/ai halo");
    let k = await dataKoneksi(db, at(12, 1));
    expect(k.grup).toMatchObject({ strategi: "gabung", berikut: null, hariIni: 1, roda: ["claude", "gemini", "openrouter"] });
    expect(k.grup.per).toMatchObject({ claude: 1, gemini: 2, openrouter: 1 }); // satu draf tiap penyedia + penggabungan oleh Gemini
    await setSetting(db, "grup_ai_strategi", "giliran");
    k = await dataKoneksi(db, at(12, 2));
    expect(k.grup.strategi).toBe("giliran");
    expect(k.grup.berikut).not.toBeNull();
  });
});

describe("kualitas jawaban: premium & tanpa bocoran cara kerja internal", () => {
  it("bersihkanBalasan membuang kalimat tentang penyedia yang bergiliran / tanpa detail model", () => {
    const bocor = 'Halo Paw! 👋 Aku belajar dari banyak teks.\n\nTapi ingat ya, aku tidak punya akses internet atau info real-time, dan jawabanku dikerjakan bergiliran oleh beberapa penyedia AI tanpa detail model spesifik. Mau coba tanyain sesuatu?';
    const bersih = bersihkanBalasan(bocor);
    expect(bersih).not.toMatch(/bergiliran|penyedia|detail model/i);
    expect(bersih).toContain("Aku belajar dari banyak teks.");
    expect(bersih).toContain("Mau coba tanyain sesuatu?");
    // kalimat biasa yang kebetulan memuat kata "giliran" tidak ikut terbuang
    expect(bersihkanBalasan("Sekarang giliran kamu menjawab. Penyedia listrik di sini bagus.")).toBe("Sekarang giliran kamu menjawab. Penyedia listrik di sini bagus.");
  });

  it("jawaban yang membocorkan cara kerja disaring sebelum sampai ke grup", async () => {
    await siapkan(["claude"]);
    jawab.claude = () => ok("*ChadGPT 6-Astrea* di sini.\n\nJawabanku dikerjakan bergiliran oleh beberapa penyedia AI tanpa detail model spesifik. Kalau mau, tanyakan hal lain.");
    const r = await kirim("/ai kenapa kamu bisa pintar banget?");
    expect(r).toContain("ChadGPT 6-Astrea");
    expect(r).not.toMatch(/bergiliran|penyedia|detail model/i);
    expect(r).toContain("tanyakan hal lain");
  });

  it("instruksi kualitas: langsung ke inti, spesifik, panjang menyesuaikan, batas hanya disebut kalau relevan", () => {
    expect(SYSTEM_GRUP).toContain("Langsung ke inti");
    expect(SYSTEM_GRUP).toContain("Substantif dan spesifik");
    expect(SYSTEM_GRUP).toContain("Sesuaikan panjang dengan soalnya");
    expect(SYSTEM_GRUP).toContain("HANYA kalau permintaannya memang membutuhkan itu");
    expect(SYSTEM_EDITOR).toContain("selevel jawaban asisten AI premium");
    expect(SYSTEM_EDITOR).toContain("Buang basa-basi");
  });
});

describe("Groq di AI grup: penyedia keempat", () => {
  const SEMUA = ["claude", "gemini", "openrouter", "groq"] as const;
  const adaGabungan = (pr: string) => pr.includes("## Jawaban A");
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
  const pasang = () => {
    jawab.claude = (pr) => (adaGabungan(pr) ? ok("FINAL claude") : ok("draf claude"));
    jawab.gemini = (pr) => (adaGabungan(pr) ? ok("FINAL gemini") : ok("draf gemini"));
    jawab.openrouter = (pr) => (adaGabungan(pr) ? ok("FINAL openrouter") : ok("draf openrouter"));
    jawab.groq = (pr) => (adaGabungan(pr) ? ok("FINAL groq") : ok("draf groq"));
  };

  it("bergiliran: Claude → Gemini → OpenRouter → Groq → Claude …", async () => {
    await siapkan([...SEMUA]);
    for (let i = 0; i < 8; i++) await kirim(`/ai tanya ${i}`, { nomor: `62811000030${i}`, now: at(12, i) });
    expect(dipanggil).toEqual(["claude", "gemini", "openrouter", "groq", "claude", "gemini", "openrouter", "groq"]);
  });

  it("gabungan: empat draf sekaligus (berlabel A–D, urutan tetap) lalu satu penggabungan oleh Gemini", async () => {
    await siapkan([...SEMUA], { strategi: "gabung" });
    pasang();
    const r = await kirim("/ai halo");
    expect(r).toContain("FINAL gemini");
    expect(dipanggil.slice(0, 4).sort()).toEqual(["claude", "gemini", "groq", "openrouter"]);
    expect(dipanggil).toHaveLength(5);
    expect(dipanggil[4]).toBe("gemini");
    const g = prompts.find(adaGabungan)!;
    expect(g).toMatch(/## Jawaban A\ndraf claude[\s\S]*## Jawaban B\ndraf gemini[\s\S]*## Jawaban C\ndraf openrouter[\s\S]*## Jawaban D\ndraf groq/);
    expect(r).toMatch(/_digabung dari Claude · haiku, Gemini · gemini-[\w.-]+, OpenRouter · [\w.-]+, Groq · llama-3\.3-70b-versatile_$/);
  });

  it("penggabung cadangan: Gemini tidak ada → Groq (cepat) yang menggabungkan; Groq gagal → OpenRouter", async () => {
    await siapkan(["claude", "openrouter", "groq"], { strategi: "gabung" });
    pasang();
    expect(await kirim("/ai halo", { nomor: "628111111101", now: at(12, 0) })).toContain("FINAL groq");
    dipanggil = [];
    jawab.groq = (pr) => (adaGabungan(pr) ? sibuk() : ok("draf groq"));
    expect(await kirim("/ai halo lagi", { nomor: "628111111102", now: at(12, 1) })).toContain("FINAL openrouter");
  });

  it("Groq kehabisan batas: penyedia lain tetap menjawab (bergiliran: pindah ke berikutnya)", async () => {
    await siapkan([...SEMUA]);
    jawab.groq = () => ({ ok: false, alasan: "limit", pesan: "Rate limit reached", durasiMs: 3 });
    for (let i = 0; i < 4; i++) expect(await kirim(`/ai t${i}`, { nomor: `62811000040${i}`, now: at(12, i) })).toMatch(/jawaban (claude|gemini|openrouter)/);
  });

  it("foto: Groq tidak ikut; OpenRouter bermodel terpasang juga tidak", async () => {
    await siapkan([...SEMUA], { strategi: "gabung" });
    pasang();
    const r = await prosesPesanGrup(db, { nomor: "628111111111", text: "/ai ini apa?", waktu: at(12), gambar: async () => PNG, grup: { jid: GRUP, nama: "Budi", disapa: false } }, at(12));
    expect(r).toContain("FINAL");
    expect(dipanggil).not.toContain("groq");
    expect(dipanggil).not.toContain("openrouter");
    expect(dipanggil.slice(0, 2).sort()).toEqual(["claude", "gemini"]);
  });

  it("`!aigrup aktif` & status menyebut keempat penyedia; peta Koneksi memuat Groq di roda", async () => {
    await siapkan([...SEMUA], { strategi: "gabung" });
    await setSetting(db, "grup_ai_jid", "");
    const r = await kirim("!aigrup aktif", { nomor: OWNER, jid: GRUP });
    expect(r).toContain("Claude + Gemini + OpenRouter + Groq");
    expect(await kirim("!aigrup status", { nomor: OWNER })).toContain("Penyedia: Claude + Gemini + OpenRouter + Groq");
    expect((await dataKoneksi(db, at(12))).grup.roda).toEqual(["claude", "gemini", "openrouter", "groq"]);
  });
});

describe("pertanyaan teknis: cara kerja yang sebenarnya", () => {
  it("mengenali pertanyaan tentang cara kerja asistennya, bukan topik teknis lain", () => {
    for (const t of ["gimana cara kerjamu?", "cara kerja kamu gimana sih", "kamu pakai model apa", "kamu pake ai apa?", "model apa yang kamu pakai di belakang?", "jelasin dong cara kerja kamu di belakang layar", "kamu itu pakai chatgpt ya?", "arsitektur bot ini gimana?", "kenapa kamu lama banget jawabnya?", "kamu dijalankan di mana?", "teknologi apa yang kamu pakai?", "how do you work?", "what model are you using under the hood?", "secara teknis kamu gimana bekerja?"]) {
      expect(pertanyaanTeknis(t), t).toBe(true);
    }
    for (const t of ["gimana cara kerja mesin cuci?", "kamu pakai apa buat belajar coding?", "gimana cara kerja blockchain", "model apa yang cocok buat mobil listrik", "kenapa langit biru?", "cara kerja vaksin gimana", "apa itu server?", "ai apa yang paling bagus untuk belajar coding?", "siapa kamu?", "kamu pakai kacamata ya?"]) {
      expect(pertanyaanTeknis(t), t).toBe(false);
    }
  });

  it("lembar fakta menjelaskan alur yang benar dan tidak berisi rahasia", () => {
    const g = caraKerja(["claude", "gemini", "openrouter", "groq"], "gabung", { mode: "perintah" });
    for (const k of ["ChadGPT 6-Astrea", "Baileys", "Haiku", "Sonnet", "Opus", "SEMUA penyedia yang tersambung sekaligus", "editor", "Gemini", "OpenRouter", "Groq", "15 detik", "30 detik", "60 detik", "Penyedia yang tersambung sekarang: Claude, Gemini, OpenRouter, Groq", "diawali /ai", "Tidak ada batas jumlah pertanyaan", "tidak bisa membuat gambar", "Anthropic, Google, OpenRouter, Groq"]) {
      expect(g, k).toContain(k);
    }
    expect(g).not.toMatch(/DompetKos|sk-|token-claude|6285163544535|08\d{8,}/i);
    const b = caraKerja(["claude", "gemini"], "giliran", { mode: "semua" });
    expect(b).toContain("bergiliran (round robin)");
    expect(b).not.toContain("SEMUA penyedia yang tersambung sekaligus");
    expect(b).toContain("setiap pesan di grup");
    expect(caraKerja(["claude"], "gabung")).toContain("tanpa tahap penggabungan"); // satu penyedia: tidak ada yang digabung
  });

  it("pertanyaan teknis: fakta disisipkan ke draf & penggabungan, jawaban tentang cara kerja tidak disaring", async () => {
    await siapkan(["claude", "gemini", "openrouter"], { strategi: "gabung" });
    const jelas = "Aku *ChadGPT 6-Astrea*. Jawabanku dikerjakan bergiliran oleh beberapa penyedia AI lalu digabung oleh editor.";
    jawab.claude = (pr) => ok(jelas);
    jawab.gemini = (pr) => ok(pr.includes("## Jawaban A") ? jelas : "draf gemini");
    jawab.openrouter = () => ok("draf openrouter");
    const r = await kirim("/ai gimana cara kerjamu di belakang layar?");
    expect(r).toContain("bergiliran oleh beberapa penyedia AI"); // pertanyaan teknis: boleh membahas cara kerja
    expect(prompts.filter((p) => p.includes("# Fakta cara kerja"))).toHaveLength(4); // tiga draf + satu penggabungan
    expect(prompts.every((p) => p.includes("Penyedia yang tersambung sekarang: Claude, Gemini, OpenRouter."))).toBe(true);
    expect(prompts[0]).toContain("# Pesan baru dari Budi");
  });

  it("pertanyaan biasa tidak membawa lembar fakta; pertanyaan lanjutan setelah pertanyaan teknis membawanya", async () => {
    await siapkan(["claude"], { strategi: "gabung" });
    await kirim("/ai apa itu fotosintesis?", { now: at(12, 0, 0) });
    expect(prompts[0]).not.toContain("Fakta cara kerja");
    await kirim("/ai kamu pakai model apa sih?", { now: at(12, 1, 0) });
    expect(prompts[1]).toContain("# Fakta cara kerja");
    await kirim("/ai terus yang pertama menjawab siapa?", { now: at(12, 2, 0) }); // lanjutan: fakta masih dibawa
    expect(prompts[2]).toContain("# Fakta cara kerja");
    await kirim("/ai berapa 12 x 12?", { now: at(12, 3, 0) });
    expect(prompts[3]).toContain("# Fakta cara kerja"); // masih dalam dua giliran terakhir
    await kirim("/ai ibukota jepang?", { now: at(12, 4, 0) });
    await kirim("/ai ibukota korea?", { now: at(12, 5, 0) });
    expect(prompts[5]).not.toContain("# Fakta cara kerja"); // sudah dua giliran berlalu: kembali normal
  });

  it("strategi bergiliran: fakta menjelaskan round robin", async () => {
    await siapkan(["claude", "gemini"], { strategi: "giliran" });
    await kirim("/ai bagaimana kamu bekerja?");
    expect(prompts[0]).toContain("bergiliran (round robin)");
  });

  it("pertanyaan 'kamu pakai model apa' kini menuju penjelasan lengkap, bukan jawaban identitas singkat", async () => {
    await siapkan(["claude"]);
    expect(pertanyaanIdentitas("kamu pakai model apa")).toBe(false);
    const r = await kirim("/ai kamu pakai model apa");
    expect(r).not.toBe(IDENTITAS);
    expect(dipanggil).toEqual(["claude"]);
  });
});
