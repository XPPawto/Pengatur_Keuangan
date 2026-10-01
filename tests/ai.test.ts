import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleMessage } from "@/lib/bot/handler";
import { fromWib } from "@/lib/time";
import { argumen, bacaBatas, bacaKeluaran, golongkan, lingkunganProses, penjalanCli, type HasilClaude, type PanggilanClaude } from "@/lib/ai/claude";
import { dekripsi, enkripsi } from "@/lib/ai/rahasia";
import { bacaStatus, batasClaude, cekPulihAI, getTokenAI, jamReset, panggilAI, setPenjalanAI, simpanTokenAI, statusAI } from "@/lib/ai/panggil";
import { ambilJson, jalankanAksiAI, tanyaAsisten, validasiAksi } from "@/lib/ai/asisten";
import { undoActivity, lastUndoable } from "@/lib/services/undo";
import { jadwalkanPengingat } from "@/lib/services/scheduler";
import { cekKesehatan } from "@/lib/services/health";
import { dataKoneksi, denyutKoneksi, ringkasanPemakaian } from "@/lib/services/koneksi";
import { setSetting } from "@/lib/services/settings";
import { kalimatBebas, parseMessage } from "@/lib/parser/message";
import { resetDb } from "./helpers";

const db = new PrismaClient();
/** isi file JPEG minimal (magic bytes) untuk tes foto */
const FOTO = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0]);
const ABDUL = "085163544535";
const ORTU = "628979936381";
const at = (tgl: string, jam = 12, menit = 0) => fromWib(tgl, jam, menit);
const kirim = (text: string, now: Date) => handleMessage(db, { nomor: ABDUL, text, now });

type Panggilan = PanggilanClaude & { token: string | null };
let panggilan: Panggilan[] = [];
let jawab: (p: Panggilan) => HasilClaude;
const ok = (teks: string): HasilClaude => ({ ok: true, teks, durasiMs: 5, token: { masuk: 1200, keluar: 80 } });
const gagal = (alasan: Extract<HasilClaude, { ok: false }>["alasan"], pesan = "error"): HasilClaude => ({ ok: false, alasan, pesan, durasiMs: 5 });
const json = (o: unknown) => ok(JSON.stringify(o));
const sambung = () => simpanTokenAI(db, "sk-ant-oat01-token-tes-yang-cukup-panjang");

let pulihkan: () => void;
beforeEach(async () => {
  await resetDb(db);
  panggilan = [];
  jawab = () => json({ balasan: "Oke.", aksi: [], memori: [] });
  pulihkan = setPenjalanAI(async (p) => {
    panggilan.push(p);
    return jawab(p);
  });
});
afterEach(() => pulihkan());
afterAll(() => db.$disconnect());

async function mulai4Okt() {
  await kirim("masuk 300", at("2026-10-04", 10));
  await kirim("ok", at("2026-10-04", 10));
}

// ---------------------------------------------------------------- runner

describe("runner Claude Code CLI", () => {
  const FAKE = path.resolve(import.meta.dirname, "fixtures/fake-claude.mjs");
  const jalankan = async (prompt: string, o: Partial<PanggilanClaude> = {}) => {
    const lama = process.env.CLAUDE_BIN;
    process.env.CLAUDE_BIN = FAKE;
    try {
      return await penjalanCli({ system: "sys", prompt, model: "haiku", token: "tok-rahasia", ...o });
    } finally {
      process.env.CLAUDE_BIN = lama;
    }
  };

  it("menggolongkan error jadi alasan yang bisa ditindaklanjuti", () => {
    expect(golongkan("Failed to authenticate. API Error: 401 Invalid bearer token", 401)).toBe("belum_login");
    expect(golongkan("Not logged in · Please run /login")).toBe("belum_login");
    expect(golongkan("Claude AI usage limit reached|1760000000")).toBe("limit");
    expect(golongkan("x", 429)).toBe("limit");
    expect(golongkan("API Error: 529 overloaded")).toBe("sibuk");
    expect(golongkan("sesuatu yang aneh")).toBe("gagal");
  });

  it("membaca hasil JSON walau ada baris lain", () => {
    expect(bacaKeluaran('peringatan\n{"type":"result","result":"hai","subtype":"success"}')?.result).toBe("hai");
    expect(bacaKeluaran("bukan json")).toBeNull();
  });

  it("argumen: tanpa tool & prompt tidak lewat argumen; foto hanya boleh Read", () => {
    const a = argumen({ system: "S", prompt: "DATA RAHASIA", model: "sonnet" });
    expect(a).toEqual(expect.arrayContaining(["-p", "--output-format", "stream-json", "--verbose", "--model", "sonnet", "--no-session-persistence"]));
    expect(a[a.indexOf("--tools") + 1]).toBe("");
    expect(a.join(" ")).not.toContain("DATA RAHASIA");
    const g = argumen({ system: "S", prompt: "p", model: "sonnet", gambar: "/tmp/x.jpg" });
    expect(g[g.indexOf("--tools") + 1]).toBe("Read");
  });

  it("lingkungan proses dibuat dari nol: API key berbayar tidak pernah diteruskan", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-api-berbayar";
    const env = lingkunganProses("tok");
    delete process.env.ANTHROPIC_API_KEY;
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("tok");
    expect(env.CLAUDE_CONFIG_DIR).toBe(env.HOME);
  });

  it("token disimpan terenkripsi", () => {
    const s = enkripsi("sk-ant-oat01-abc");
    expect(s).not.toContain("sk-ant");
    expect(dekripsi(s)).toBe("sk-ant-oat01-abc");
    expect(dekripsi(s.slice(0, -4) + "AAAA")).toBeNull();
  });

  it("spawn CLI: token lewat env, prompt lewat stdin, token pemakaian terbaca", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-api-berbayar";
    const h = await jalankan("halo claude");
    delete process.env.ANTHROPIC_API_KEY;
    expect(h.ok).toBe(true);
    if (!h.ok) return;
    const r = JSON.parse(h.teks);
    expect(r).toMatchObject({ token: "tok-rahasia", apiKey: null, panjangPrompt: "halo claude".length });
    expect(r.args).toContain("haiku");
    expect(r.args).toEqual(expect.arrayContaining(["stream-json", "--verbose"]));
    expect(h.token).toEqual({ masuk: 105, keluar: 20 });
    expect(h.batas?.jendela).toEqual({ five_hour: { persen: 34, resetsAt: 1791000000 }, seven_day: { persen: 61, resetsAt: 1791400000 } });
  });

  it("membaca batas langganan dari rate_limit_event (per jendela maupun bidang utama)", () => {
    const ev = (info: unknown) => JSON.stringify({ type: "rate_limit_event", rate_limit_info: info });
    const b = bacaBatas([ev({ status: "allowed_warning", rateLimitType: "seven_day", utilization: 0.825, resetsAt: 1791400000 }), '{"type":"result","result":"x"}'].join("\n"));
    expect(b).toEqual({ status: "allowed_warning", jenis: "seven_day", resetsAt: 1791400000, jendela: { seven_day: { persen: 82.5, resetsAt: 1791400000 } } });
    expect(bacaBatas(ev({ status: "allowed", unifiedWindows: { five_hour: { utilization: 0.1, resetsAt: 1 } } }))?.jendela.five_hour?.persen).toBe(10);
    expect(bacaBatas('{"type":"result","result":"x"}')).toBeUndefined();
  });

  it("bentuk event asli Claude Code: versi baru (unifiedWindows) terbaca, versi lama (tanpa angka) tidak merusak", () => {
    const ev = (info: unknown) => JSON.stringify({ type: "rate_limit_event", rate_limit_info: info, uuid: "u", session_id: "s" });
    const dasar = { status: "allowed", resetsAt: 1790854800, rateLimitType: "five_hour", overageStatus: "rejected", overageDisabledReason: "org_level_disabled", isUsingOverage: false };
    // Claude Code >= ~2.1.28x: membawa persentase sesi 5 jam & mingguan
    const baru = bacaBatas(ev({ ...dasar, unifiedWindows: { five_hour: { utilization: 0.04, resetsAt: 1790854800 }, seven_day: { utilization: 0.09, resetsAt: 1791392400 } } }));
    expect(baru).toEqual({
      status: "allowed",
      jenis: "five_hour",
      resetsAt: 1790854800,
      jendela: { five_hour: { persen: 4, resetsAt: 1790854800 }, seven_day: { persen: 9, resetsAt: 1791392400 } },
    });
    // Claude Code 2.1.197: hanya status + waktu reset, tanpa persentase → jendela kosong, status tetap terbaca
    const lama = bacaBatas(ev(dasar));
    expect(lama).toMatchObject({ status: "allowed", jenis: "five_hour", resetsAt: 1790854800, jendela: {} });
  });

  it("spawn CLI: 401, limit, timeout, keluaran rusak, CLI tidak ada", async () => {
    expect(await jalankan("MODE:401")).toMatchObject({ ok: false, alasan: "belum_login" });
    expect(await jalankan("MODE:limit")).toMatchObject({ ok: false, alasan: "limit", batas: { status: "rejected" } });
    expect(await jalankan("MODE:diam", { timeoutMs: 400 })).toMatchObject({ ok: false, alasan: "timeout" });
    expect(await jalankan("MODE:rusak")).toMatchObject({ ok: false, alasan: "gagal" });
    expect(await penjalanCli({ system: "s", prompt: "p", model: "haiku", token: null })).toMatchObject({ ok: false, alasan: "tidak_ada" });
  });
});

// ---------------------------------------------------------------- penjaga

describe("penjaga panggilAI", () => {
  const tanya = (now: Date, fitur: "chat_web" | "cek" = "chat_web") => panggilAI(db, { fitur, system: "s", prompt: "p", now });

  it("tanpa token: belum_diatur, Claude tidak dipanggil; saklar mati: dimatikan", async () => {
    expect(await tanya(at("2026-10-05"))).toMatchObject({ ok: false, alasan: "belum_diatur" });
    await sambung();
    await setSetting(db, "ai_aktif", "0");
    expect(await tanya(at("2026-10-05"))).toMatchObject({ ok: false, alasan: "dimatikan" });
    expect(panggilan).toHaveLength(0);
  });

  it("token website dipakai & tersamar; kuota harian dihitung, cek koneksi tidak", async () => {
    await sambung();
    expect((await getTokenAI(db)).sumber).toBe("website");
    expect((await statusAI(db, at("2026-10-05"))).token.samaran).toBe("••••jang");
    await setSetting(db, "ai_batas_harian", "2");
    await tanya(at("2026-10-05", 9));
    await tanya(at("2026-10-05", 10));
    expect(await tanya(at("2026-10-05", 11))).toMatchObject({ ok: false, alasan: "kuota" });
    expect(await tanya(at("2026-10-05", 11), "cek")).toMatchObject({ ok: true });
    expect(await tanya(at("2026-10-06", 9))).toMatchObject({ ok: true }); // hari baru
    expect(panggilan[0].token).toBe("sk-ant-oat01-token-tes-yang-cukup-panjang");
    const log = await db.aiCall.findFirst();
    expect(log).toMatchObject({ status: "ok", tokenMasuk: 1200, tokenKeluar: 80 });
  });

  it("token ditolak: pemilik dikabari sekali, panggilan ditahan 10 menit, pulih → dikabari lagi", async () => {
    await sambung();
    jawab = () => gagal("belum_login", "401 Invalid bearer token");
    await tanya(at("2026-10-05", 9));
    await tanya(at("2026-10-05", 9, 5)); // masih ditahan → Claude tidak dipanggil
    expect(panggilan).toHaveLength(1);
    expect((await bacaStatus(db)).status).toBe("belum_login");
    const kabar = await db.outbox.findMany({ where: { jenis: "ai_status" } });
    expect(kabar).toHaveLength(2); // dua nomor pemilik
    expect(kabar[0].isi).toContain("claude setup-token");

    await tanya(at("2026-10-05", 9, 12));
    expect(panggilan).toHaveLength(2);
    expect(await db.outbox.count({ where: { jenis: "ai_status" } })).toBe(2); // tidak dobel

    jawab = () => ok("siap");
    expect(await cekPulihAI(db, at("2026-10-05", 9, 30))).toBe(true);
    expect((await bacaStatus(db)).status).toBe("ok");
    const pulih = await db.outbox.findMany({ where: { jenis: "ai_status", isi: { contains: "aktif lagi" } } });
    expect(pulih).toHaveLength(2);
    expect(await cekPulihAI(db, at("2026-10-05", 10))).toBe(false); // sehat → tidak perlu cek
  });
});

describe("batas langganan Claude (sesi 5 jam & mingguan)", () => {
  const detik = (d: Date) => Math.floor(d.getTime() / 1000);
  const tanya = (now: Date, fitur: "chat_web" | "kategori" = "chat_web") => panggilAI(db, { fitur, system: "s", prompt: "p", now });

  it("angka terakhir disimpan; setelah lewat waktu reset dianggap 0%", async () => {
    await sambung();
    const now = at("2026-10-05", 9);
    jawab = () => ({ ...ok("x"), batas: { status: "allowed", jendela: { five_hour: { persen: 40, resetsAt: detik(at("2026-10-05", 12)) }, seven_day: { persen: 70, resetsAt: detik(at("2026-10-08", 7)) } } } });
    await tanya(now);
    const b = await batasClaude(db, at("2026-10-05", 10));
    expect(b.map((x) => [x.kode, x.persen, x.reset])).toEqual([
      ["five_hour", 40, "12.00"],
      ["seven_day", 70, "Kam 07.00"],
    ]);
    const nanti = await batasClaude(db, at("2026-10-05", 13));
    expect(nanti[0]).toMatchObject({ persen: 0, sudahReset: true });
    expect((await dataKoneksi(db, at("2026-10-05", 10))).ai).toMatchObject({ sesi5Jam: 40, mingguan: 70 });
  });

  it("kena batas: AI istirahat persis sampai jam reset, pemilik diberi tahu jamnya", async () => {
    await sambung();
    jawab = () => ({ ...gagal("limit", "usage limit reached"), batas: { status: "rejected", jenis: "five_hour", resetsAt: detik(at("2026-10-05", 11)), jendela: { five_hour: { persen: 100, resetsAt: detik(at("2026-10-05", 11)) } } } });
    await tanya(at("2026-10-05", 9));
    const kabar = await db.outbox.findFirst({ where: { jenis: "ai_status" } });
    expect(kabar?.isi).toContain("reset (11.00)");
    expect((await statusAI(db, at("2026-10-05", 9, 30))).tahanSampai).toBe("11.00");
    const r = await tanya(at("2026-10-05", 10, 30)); // lebih dari 20 menit, tapi belum reset
    expect(r).toMatchObject({ ok: false, alasan: "limit" });
    expect(panggilan).toHaveLength(1);
    expect(await cekPulihAI(db, at("2026-10-05", 10, 45))).toBe(false);
    jawab = () => ok("siap");
    expect(await cekPulihAI(db, at("2026-10-05", 11, 1))).toBe(true);
    expect(panggilan).toHaveLength(2);
  });

  it("hemat otomatis: sesi 5 jam ≥90% → tugas kecil tidak memakai Claude, ngobrol tetap jalan", async () => {
    await sambung();
    jawab = () => ({ ...ok("x"), batas: { jendela: { five_hour: { persen: 92, resetsAt: detik(at("2026-10-05", 12)) } } } });
    await tanya(at("2026-10-05", 9));
    expect(await tanya(at("2026-10-05", 9, 1), "kategori")).toMatchObject({ ok: false, alasan: "limit" });
    expect(await tanya(at("2026-10-05", 9, 2))).toMatchObject({ ok: true });
    expect(panggilan).toHaveLength(2);
    expect((await bacaStatus(db)).status).toBe("ok"); // penghematan bukan gangguan
  });

  it("format jam reset", () => {
    const now = at("2026-10-05", 9);
    expect(jamReset(detik(at("2026-10-05", 14, 5)), now)).toBe("14.05");
    expect(jamReset(detik(at("2026-10-06", 7)), now)).toBe("besok 07.00");
    expect(jamReset(detik(at("2026-10-20", 7)), now)).toBe("20 Okt 07.00");
  });
});

// ---------------------------------------------------------------- asisten

describe("asisten: konteks, usulan, memori", () => {
  it("jawaban + aksi divalidasi; memori langsung tersimpan; obrolan nyambung", async () => {
    await mulai4Okt();
    await sambung();
    jawab = () =>
      json({
        balasan: "Ini dia.",
        aksi: [
          { jenis: "catat", nominal: 15000, amplop: "makan", catatan: "geprek" },
          { jenis: "catat", nominal: 15000, amplop: "kado", catatan: "dari tabungan" }, // amplop tidak boleh
          { jenis: "catat", nominal: 99_000_000, amplop: "makan", catatan: "kebanyakan" }, // nominal tidak masuk akal
          { jenis: "pindah", nominal: 10000, dari: "kado", ke: "makan", alasan: "x" }, // kado terkunci
          { jenis: "pindah", nominal: 10000, dari: "darurat", ke: "makan", alasan: "jajan malam" },
          { jenis: "belanja", nama: "tempe", jumlah: 2, satuan: "papan", harga: 5000 },
          { jenis: "pesan_keluarga", isi: "Ayah, makasih ya kirimannya." },
          { jenis: "kata", kata: "Geprek", amplop: "makan" },
          { jenis: "hapus_semua" },
        ],
        memori: [{ ingat: "Kado buat adik, ultah 20 Nov" }],
      });
    const r = await tanyaAsisten(db, { kanal: ABDUL, pesan: "tolong bantu", now: at("2026-10-05") });
    expect(r.ok).toBe(true);
    expect(r.aksi.map((a) => a.jenis)).toEqual(["catat", "pindah", "belanja", "pesan_keluarga", "kata"]);
    expect(r.aksi[4]).toMatchObject({ kata: "geprek" });
    expect(r.memori).toEqual(["Diingat: Kado buat adik, ultah 20 Nov"]);
    expect(await db.aiMemori.count()).toBe(1);

    const p1 = panggilan[0].prompt;
    expect(p1).toContain("## Amplop");
    expect(p1).toContain("- makan (Makan)");
    expect(p1).not.toContain("Percakapan sebelumnya");

    jawab = () => json({ balasan: "Lanjut.", aksi: [], memori: [] });
    await tanyaAsisten(db, { kanal: ABDUL, pesan: "terus gimana?", now: at("2026-10-05", 12, 5) });
    const p2 = panggilan[1].prompt;
    expect(p2).toContain("Pemilik: tolong bantu");
    expect(p2).toContain("[usulan 1] Catat geprek");
    expect(p2).toContain("Kado buat adik"); // memori ikut di konteks
    expect(panggilan[1].system).toContain("HANYA satu objek JSON");
  });

  it("jawaban bukan JSON tetap ditampilkan sebagai teks, tanpa aksi", async () => {
    await sambung();
    jawab = () => ok("Halo! Ada yang bisa gw bantu?");
    const r = await tanyaAsisten(db, { kanal: "web", pesan: "halo", now: at("2026-10-05") });
    expect(r).toMatchObject({ ok: true, balasan: "Halo! Ada yang bisa gw bantu?", aksi: [] });
    expect(ambilJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("aksi yang disetujui jalan & bisa dibatalkan", async () => {
    await mulai4Okt();
    const now = at("2026-10-05");
    const aksi = await validasiAksi(
      db,
      [
        { jenis: "catat", nominal: 15000, amplop: "makan", catatan: "geprek" },
        { jenis: "catat", nominal: 10000, amplop: "darurat", catatan: "bensin", tanggal: "2026-10-04" },
        { jenis: "belanja", nama: "tempe", jumlah: 2, satuan: "papan", harga: 5000 },
        { jenis: "pesan_keluarga", isi: "Ayah, makasih ya." },
      ],
      now,
    );
    const r = await jalankanAksiAI(db, aksi, { oleh: ABDUL, sumber: "wa" }, now);
    expect(r.gagal).toEqual([]);
    expect(r.berhasil).toHaveLength(4);
    const tx = await db.transaction.findMany({ orderBy: { id: "asc" } });
    expect(tx.map((t) => [t.nominal, t.tanggal])).toEqual([
      [15000, "2026-10-05"],
      [10000, "2026-10-04"],
    ]);
    expect(await db.outbox.findFirst({ where: { jenis: "pesan_keluarga" } })).toMatchObject({ nomor: ORTU, isi: "Ayah, makasih ya." });

    const belanja = await lastUndoable(db);
    expect(belanja?.aksi).toBe("belanja_tambah");
    await undoActivity(db, belanja!.id, { oleh: ABDUL, sumber: "wa" }, now);
    expect(await db.shoppingItem.count({ where: { nama: "tempe" } })).toBe(0);
    const catat = await lastUndoable(db);
    await undoActivity(db, catat!.id, { oleh: ABDUL, sumber: "wa" }, now);
    expect(await db.transaction.count()).toBe(0);
  });
});

// ---------------------------------------------------------------- bot WhatsApp

describe("bot WhatsApp + asisten", () => {
  it("parser: kalimat bebas vs perintah", () => {
    const cek = (t: string) => kalimatBebas(t, parseMessage(t));
    expect(cek("tadi geprek 15 sama es teh 5, terus isi kuota 25, kemarin bensin 10")).toBe(true);
    expect(cek("boleh beli sepatu 150rb ga?")).toBe(true);
    expect(cek("berapa total jajan gw bulan september?")).toBe(true);
    expect(cek("tempe 5k sama telur 14k")).toBe(false);
    expect(cek("es teh sama gorengan 8k")).toBe(false);
    expect(cek("seblak")).toBe(false);
    expect(parseMessage("tanya boleh beli sepatu?")).toEqual({ type: "tanya", pertanyaan: "boleh beli sepatu?" });
    expect(parseMessage("Inget ya kalau kado buat Adik")).toEqual({ type: "ingat", isi: "kado buat Adik" });
    expect(parseMessage("lupakan 2")).toEqual({ type: "lupakan", id: 2 });
  });

  it("tanpa token: perintah biasa tetap jalan, pertanyaan diberi tahu AI belum disambungkan", async () => {
    await mulai4Okt();
    const [r] = await kirim("kenapa minggu ini boros", at("2026-10-05"));
    expect(r).toContain("belum disambungkan");
    const [t] = await kirim("tanya halo", at("2026-10-05"));
    expect(t).toContain("belum disambungkan");
    expect(t).toContain("Sementara, ini kondisi lo sekarang");
    const [c] = await kirim("tempe 5k", at("2026-10-05"));
    expect(c).toContain("Tempe Rp5.000 masuk ke Makan".replace("Tempe", "tempe"));
    expect(panggilan).toHaveLength(0);
  });

  it("AI dimatikan: pertanyaan jatuh ke balasan biasa", async () => {
    await setSetting(db, "ai_aktif", "0");
    const [r] = await kirim("kenapa minggu ini boros", at("2026-10-05"));
    expect(r).toContain("belum ngerti");
  });

  it("pertanyaan bebas dijawab asisten", async () => {
    await mulai4Okt();
    await sambung();
    jawab = () => json({ balasan: "*Kenapa boros*\nJajan malam 3x.", aksi: [], memori: [] });
    const [r] = await kirim("kenapa minggu ini boros?", at("2026-10-05"));
    expect(r).toBe("*Kenapa boros*\nJajan malam 3x.");
    expect(panggilan[0].prompt).toContain("kenapa minggu ini boros?");
  });

  it("cerita pengeluaran → usulan → `ok 1 3` menjalankan sebagian", async () => {
    await mulai4Okt();
    await sambung();
    jawab = () =>
      json({
        balasan: "Gw pecah jadi 3 ya.",
        aksi: [
          { jenis: "catat", nominal: 15000, amplop: "makan", catatan: "geprek" },
          { jenis: "catat", nominal: 5000, amplop: "makan", catatan: "es teh" },
          { jenis: "catat", nominal: 10000, amplop: "darurat", catatan: "bensin", tanggal: "2026-10-04" },
        ],
        memori: [],
      });
    const [r] = await kirim("tadi geprek 15 sama es teh 5, kemarin bensin 10", at("2026-10-05"));
    expect(r).toContain("*Usulan:*");
    expect(r).toContain("3. Catat bensin Rp10.000 → Darurat & kos (tanggal 2026-10-04)");
    expect(await db.transaction.count({ where: { tanggal: { gte: "2026-10-05" } } })).toBe(0);

    const [j] = await kirim("ok 1 3", at("2026-10-05", 12, 1));
    expect(j).toContain("*Beres:*");
    const tx = await db.transaction.findMany({ where: { pesanAsli: "[asisten]" }, include: { envelope: true }, orderBy: { id: "asc" } });
    expect(tx.map((t) => [t.catatan, t.envelope.kode, t.tanggal])).toEqual([
      ["geprek", "makan", "2026-10-05"],
      ["bensin", "darurat", "2026-10-04"],
    ]);
    // `batal` membatalkan catatan dari asisten
    await kirim("batal", at("2026-10-05", 12, 2));
    await kirim("ok", at("2026-10-05", 12, 2));
    expect(await db.transaction.count({ where: { pesanAsli: "[asisten]" } })).toBe(0);
  });

  it("usulan bisa dibuang dengan `batal`", async () => {
    await mulai4Okt();
    await sambung();
    jawab = () => json({ balasan: "Ok.", aksi: [{ jenis: "catat", nominal: 15000, amplop: "makan", catatan: "geprek" }], memori: [] });
    await kirim("tadi abis makan geprek 15 enak banget", at("2026-10-05"));
    const [r] = await kirim("batal", at("2026-10-05"));
    expect(r).toContain("gw buang");
    expect(await db.pendingAction.count()).toBe(0);
  });

  it("AI gagal: pemilik dapat penjelasan + pesan diproses parser biasa", async () => {
    await mulai4Okt();
    await sambung();
    jawab = () => gagal("belum_login", "401");
    const [r] = await kirim("tadi geprek 15 sama es teh 5, kemarin bensin 10k", at("2026-10-05"));
    expect(r).toContain("token Claude ditolak");
    expect(r).toContain("cara biasa");
    expect(await db.outbox.count({ where: { jenis: "ai_status" } })).toBe(2);
  });

  it("kata baru: AI menebak amplop, `ok` mencatat & bot belajar", async () => {
    await mulai4Okt();
    await sambung();
    jawab = (p) => (p.system.includes("menebak amplop") ? json({ amplop: "makan", kata: "seblak", yakin: true }) : json({ balasan: "?", aksi: [] }));
    const [r] = await kirim("seblak 12k", at("2026-10-05"));
    expect(r).toContain("kayaknya masuk *Makan* (tebakan AI)");
    await kirim("ok", at("2026-10-05"));
    expect(await db.kataKategori.findUnique({ where: { kata: "seblak" } })).toMatchObject({ envelopeKode: "makan", sumber: "ai" });
    const n = panggilan.length;
    const [lagi] = await kirim("seblak pedas 10k", at("2026-10-06"));
    expect(lagi).toContain("masuk ke Makan");
    expect(panggilan).toHaveLength(n); // langsung dikenali, tanpa AI
  });

  it("tanpa AI: bot belajar dari pilihan amplop", async () => {
    await mulai4Okt();
    await kirim("cilok 5k", at("2026-10-05"));
    await kirim("1", at("2026-10-05"));
    const [r] = await kirim("cilok 3k", at("2026-10-06"));
    expect(r).toContain("cilok Rp3.000 masuk ke Makan");
  });

  it("ingat, memori, lupakan, reset obrolan (tanpa AI)", async () => {
    const [a] = await kirim("ingat kado buat adik ultah 20 Nov", at("2026-10-05"));
    expect(a).toContain('"kado buat adik ultah 20 Nov"');
    const [m] = await kirim("memori", at("2026-10-05"));
    expect(m).toMatch(/\d+\. kado buat adik/);
    const id = (await db.aiMemori.findFirst())!.id;
    const [l] = await kirim(`lupakan ${id}`, at("2026-10-05"));
    expect(l).toContain("udah gw lupain");
    expect(await db.aiMemori.count()).toBe(0);
    const [r] = await kirim("reset obrolan", at("2026-10-05"));
    expect(r).toContain("dari nol");
  });

  it("lanjutan obrolan diarahkan ke asisten", async () => {
    await mulai4Okt();
    await sambung();
    await kirim("boleh beli sepatu 150rb?", at("2026-10-05"));
    await kirim("kalau yang murah?", at("2026-10-05", 12, 3));
    await kirim("gimana", at("2026-10-05", 12, 4));
    expect(panggilan).toHaveLength(3);
  });

  it("foto struk dibaca Claude, `rinci` pakai amplop per item dari AI", async () => {
    await mulai4Okt();
    await sambung();
    jawab = (p) => {
      expect(p.gambar).toBeTruthy();
      return json({ jenis: "struk", toko: "Indomaret", tanggal: "2026-10-05", total: 23500, items: [{ nama: "telur", harga: 14000, amplop: "makan" }, { nama: "tempe", harga: 5000, amplop: "makan" }, { nama: "sabun", harga: 4500, amplop: "darurat" }] });
    };
    const [r] = await handleMessage(db, { nomor: ABDUL, text: "", now: at("2026-10-05"), gambar: async () => FOTO });
    expect(r).toContain("(dibaca AI)");
    expect(r).toContain("total Rp23.500");
    await kirim("rinci", at("2026-10-05"));
    const tx = await db.transaction.findMany({ include: { envelope: true }, orderBy: { id: "asc" } });
    expect(tx.map((t) => [t.catatan, t.envelope.kode])).toEqual([
      ["telur", "makan"],
      ["tempe", "makan"],
      ["sabun", "darurat"],
    ]);
  });

  it("foto bukti transfer → ditawarkan sebagai kiriman", async () => {
    await mulai4Okt();
    await sambung();
    jawab = () => json({ jenis: "bukti_transfer", nominal: 100000, pengirim: "Ayah", keterangan: "Transfer BRI" });
    const [r] = await handleMessage(db, { nomor: ABDUL, text: "", now: at("2026-10-05"), gambar: async () => FOTO });
    expect(r).toContain("Bukti transfer Rp100.000 dari Ayah kebaca");
    await kirim("ok", at("2026-10-05"));
    expect(await db.extraIncome.findFirst()).toMatchObject({ dari: "Ayah", nominal: 100000 });
  });

  it("Claude gagal baca foto → OCR lokal", async () => {
    await mulai4Okt();
    await sambung();
    jawab = () => gagal("sibuk");
    const [r] = await handleMessage(db, {
      nomor: ABDUL,
      text: "",
      now: at("2026-10-05"),
      gambar: async () => FOTO,
      ocr: async () => "INDOMARET\nTEMPE 5.000\nTOTAL 5.000",
    });
    expect(r).toContain("total Rp5.000");
    expect(r).not.toContain("dibaca AI");
  });

  it("nomor keluarga tidak pernah dilayani AI", async () => {
    await sambung();
    await handleMessage(db, { nomor: ORTU, text: "berapa sisa uang anakku?", now: at("2026-10-05") });
    expect(panggilan).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- terjadwal & koneksi

describe("rekap Sabtu, koneksi, kesehatan", () => {
  it("rekap Sabtu ditambah evaluasi asisten; tanpa AI rekap tetap terkirim", async () => {
    await mulai4Okt();
    await sambung();
    jawab = (p) => (p.system.includes("pelatih keuangan") ? ok("*Kata asisten*\nMinggu ini aman.\n*Tantangan minggu depan*: 2 hari tanpa jajan.") : ok("{}"));
    await jadwalkanPengingat(db, at("2026-10-10", 20, 0));
    const rekap = await db.outbox.findFirst({ where: { jenis: "rekap" } });
    expect(rekap?.isi).toContain("*Kata asisten*");
    expect(rekap?.isi).toContain("Tantangan minggu depan");
    expect(await db.aiCall.count({ where: { fitur: "review" } })).toBe(1);
    await jadwalkanPengingat(db, at("2026-10-10", 20, 3)); // tidak dipanggil ulang
    expect(await db.aiCall.count({ where: { fitur: "review" } })).toBe(1);
  });

  it("rekap tanpa token tidak memanggil AI", async () => {
    await mulai4Okt();
    await jadwalkanPengingat(db, at("2026-10-10", 20, 0));
    const rekap = await db.outbox.findFirst({ where: { jenis: "rekap" } });
    expect(rekap?.isi).not.toContain("Kata asisten");
    expect(panggilan).toHaveLength(0);
  });

  it("data peta koneksi & ringkasan pemakaian", async () => {
    let d = await dataKoneksi(db, at("2026-10-05"));
    expect(d.wa.status).toBe("terputus");
    expect(d.ai).toMatchObject({ kondisi: "belum_diatur", adaToken: false });
    expect(d.nomor).toMatchObject({ pemilik: 2, keluarga: 1 });

    await sambung();
    await tanyaAsisten(db, { kanal: "web", pesan: "halo", now: at("2026-10-05", 9) });
    jawab = () => gagal("sibuk");
    await panggilAI(db, { fitur: "struk", system: "s", prompt: "p", now: at("2026-10-05", 10) });
    d = await dataKoneksi(db, at("2026-10-05", 11));
    expect(d.fitur.find((f) => f.kode === "chat_web")).toMatchObject({ hariIni: 1, aktif: true });
    expect(d.ai.pakai).toBe(2);

    const u = await ringkasanPemakaian(db, at("2026-10-05", 11));
    expect(u.hariIni).toMatchObject({ panggilan: 2, gagal: 1, tokenMasuk: 1200, tokenKeluar: 80 });
    expect(u.tujuhHari.tingkatBerhasil).toBe(0.5);
    expect(u.perHari[u.perHari.length - 1]).toMatchObject({ chat_web: 1, struk: 1 });
    expect(u.terakhir[0].fitur).toBe("struk");
  });

  it("kesehatan sistem: AI opsional, token ditolak = masalah", async () => {
    let h = await cekKesehatan(db, at("2026-10-05"));
    expect(h.cek.find((c) => c.kode === "ai")).toMatchObject({ status: "ok", detail: "Claude belum disambungkan (opsional)" });
    await sambung();
    jawab = () => gagal("belum_login");
    await panggilAI(db, { fitur: "chat_web", system: "s", prompt: "p", now: at("2026-10-05") });
    h = await cekKesehatan(db, at("2026-10-05"));
    expect(h.cek.find((c) => c.kode === "ai")!.status).toBe("masalah");
  });
});

describe("peta koneksi realtime (denyut)", () => {
  it("panggilan Claude tercatat 'berjalan' selama Claude mikir, lalu diperbarui", async () => {
    await sambung();
    let selagiJalan: string | undefined;
    pulihkan();
    pulihkan = setPenjalanAI(async () => {
      selagiJalan = (await db.aiCall.findFirst({ orderBy: { id: "desc" } }))?.status;
      return ok("x");
    });
    await panggilAI(db, { fitur: "chat_web", system: "s", prompt: "p", now: at("2026-10-05") });
    expect(selagiJalan).toBe("berjalan");
    expect((await db.aiCall.findFirst())?.status).toBe("ok");
    const u = await ringkasanPemakaian(db, at("2026-10-05", 13));
    expect(u.hariIni).toMatchObject({ panggilan: 1, gagal: 0 });
  });

  it("aktivitas sejak kursor: arah & peran pesan (tanpa isi), panggilan Claude, cek status", async () => {
    const awal = await denyutKoneksi(db, new Date(), {});
    expect(awal).toMatchObject({ pesan: [], ai: [] });

    await kirim("tempe 5k", at("2026-10-05"));
    await handleMessage(db, { nomor: "628111111111", text: "halo", now: at("2026-10-05") }); // nomor asing: tidak ditampilkan
    await db.messageLog.create({ data: { arah: "keluar", nomor: ORTU, isi: "laporan", proaktif: true } });
    const jalan = await db.aiCall.create({ data: { fitur: "chat_wa", model: "sonnet", status: "berjalan", waktu: new Date() } });
    const basi = await db.aiCall.create({ data: { fitur: "struk", model: "sonnet", status: "berjalan", waktu: new Date(Date.now() - 10 * 60_000) } });

    const d = await denyutKoneksi(db, new Date(), { pesan: awal.kursor.pesan, ai: awal.kursor.ai });
    expect(d.pesan.map((p) => [p.arah, p.peran, p.proaktif])).toEqual([
      ["masuk", "pemilik", false],
      ["keluar", "pemilik", false],
      ["keluar", "keluarga", true],
    ]);
    expect(JSON.stringify(d.pesan)).not.toContain("tempe");
    expect(d.ai.map((a) => [a.fitur, a.status])).toEqual([
      ["chat_wa", "berjalan"],
      ["struk", "berjalan"],
    ]);

    await db.aiCall.update({ where: { id: jalan.id }, data: { status: "ok" } });
    const c = await denyutKoneksi(db, new Date(), { pesan: d.kursor.pesan, ai: d.kursor.ai, cek: [jalan.id, basi.id] });
    expect(c.pesan).toEqual([]);
    expect(c.cek.sort((a, b) => a.id - b.id)).toEqual([
      { id: jalan.id, status: "ok" },
      { id: basi.id, status: "terputus" },
    ]);

    // halaman baru dibuka: hanya panggilan yang masih berjalan (tidak memutar ulang riwayat)
    const baru = await denyutKoneksi(db, new Date(), {});
    expect(baru.ai).toEqual([]);
  });
});

