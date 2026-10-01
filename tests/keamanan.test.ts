import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { verifyPassword } from "@/lib/auth/password";
import { bacaSesi, signSession, verifySession } from "@/lib/auth/token";
import { catatLoginGagal, loginTerkunci, resetLoginGagal } from "@/lib/auth/session";
import { berkasTerbuka, kunciBerkas } from "@/lib/keamanan/berkas";
import { asalSama } from "@/lib/keamanan/asal";
import { jenisGambar } from "@/lib/keamanan/gambar";
import { catatLoginGagalKeLog, kabarLoginBaru, namaPerangkat } from "@/lib/services/keamanan";
import { requestLoginCode, verifyLoginCode } from "@/lib/services/otp";
import { argumen } from "@/lib/ai/claude";
import { handleMessage } from "@/lib/bot/handler";
import { kirimAntrean } from "@/lib/services/sender";
import { resetDb } from "./helpers";

const db = new PrismaClient();
const S = "kunci-sesi-acak-yang-panjang-sekali-0123456789";
beforeEach(() => resetDb(db));
afterAll(() => db.$disconnect());

describe("sesi", () => {
  it("SESSION_SECRET pendek ditolak (fail closed)", async () => {
    await expect(signSession("pendek")).rejects.toThrow(/minimal 32/);
    const t = await signSession(S);
    expect(await verifySession("x".repeat(20), t)).toBe(false);
  });

  it("versi sesi ikut ditandatangani; token lama tanpa versi dianggap versi 0", async () => {
    expect((await bacaSesi(S, await signSession(S, Date.now(), 3)))?.v).toBe(3);
    expect((await bacaSesi(S, await signSession(S)))?.v).toBe(0);
    // memalsukan versi merusak tanda tangan
    const [, sig] = (await signSession(S, Date.now(), 1)).split(".");
    const palsu = Buffer.from(JSON.stringify({ exp: 9999999999, v: 7 })).toString("base64url");
    expect(await bacaSesi(S, `${palsu}.${sig}`)).toBeNull();
    expect(await bacaSesi(S, "a.b.c")).toBeNull();
    expect(await bacaSesi(S, "x".repeat(600))).toBeNull();
  });

  it("password: hash rusak / input raksasa tidak membuat error", () => {
    expect(verifyPassword("x", "scrypt:aa:zz")).toBe(false);
    expect(verifyPassword("x".repeat(5000), "scrypt:00112233445566778899aabbccddeeff:00112233445566778899aabbccddeeff")).toBe(false);
  });
});

describe("pembatasan percobaan login", () => {
  it("5 gagal per IP mengunci IP itu saja; reset setelah berhasil / 15 menit", () => {
    const t = 1_000_000_000_000;
    for (let i = 0; i < 5; i++) catatLoginGagal("1.1.1.1", t + i);
    expect(loginTerkunci("1.1.1.1", t + 10)).toBe(true);
    expect(loginTerkunci("2.2.2.2", t + 10)).toBe(false);
    expect(loginTerkunci("1.1.1.1", t + 16 * 60_000)).toBe(false);
    resetLoginGagal("1.1.1.1");
  });

  it("20 gagal total (IP berganti-ganti) mengunci semua", () => {
    const t = 2_000_000_000_000;
    for (let i = 0; i < 20; i++) catatLoginGagal(`9.9.9.${i}`, t + i);
    expect(loginTerkunci("8.8.8.8", t + 100)).toBe(true);
    expect(loginTerkunci("8.8.8.8", t + 16 * 60_000)).toBe(false);
  });

  it("login baru & 5 gagal dikabari ke pemilik langsung (tanpa menunggu jam tenang)", async () => {
    const now = new Date("2026-10-05T16:00:00Z"); // 23.00 WIB, jam tenang
    await kabarLoginBaru(db, { ip: "10.0.0.5", cara: "password", ua: "Mozilla/5.0 (Linux; Android 14) Chrome/120", now });
    for (let n = 1; n <= 6; n++) await catatLoginGagalKeLog(db, { ip: "6.6.6.6", cara: "password", jumlah: n, now });
    const kabar = await db.outbox.findMany({ where: { jenis: "keamanan" } });
    expect(kabar).toHaveLength(4); // (login baru + 1 peringatan) × 2 nomor pemilik
    expect(kabar[0].isi).toContain("Chrome di Android");
    expect(await db.activityLog.count({ where: { aksi: "login_gagal" } })).toBe(6);
    const terkirim: string[] = [];
    await kirimAntrean(db, async (nomor, isi) => void terkirim.push(isi), now);
    expect(terkirim.length).toBeGreaterThanOrEqual(2);
    expect(namaPerangkat("")).toBe("browser di perangkat tak dikenal");
  });
});

describe("kode login WhatsApp", () => {
  it("minta kode baru menghanguskan kode lama; maks 5 per jam", async () => {
    await db.waConnection.upsert({ where: { id: 1 }, update: { status: "terhubung" }, create: { id: 1, status: "terhubung" } });
    const t0 = new Date("2026-10-05T03:00:00Z");
    await requestLoginCode(db, t0);
    const kode1 = /\*(\d{6})\*/.exec((await db.outbox.findFirst({ where: { jenis: "otp" }, orderBy: { id: "desc" } }))!.isi)![1];
    await requestLoginCode(db, new Date(t0.getTime() + 61_000));
    expect(await verifyLoginCode(db, kode1, new Date(t0.getTime() + 62_000))).toBe(false);
    const kode2 = /\*(\d{6})\*/.exec((await db.outbox.findFirst({ where: { jenis: "otp" }, orderBy: { id: "desc" } }))!.isi)![1];
    expect(await verifyLoginCode(db, kode2, new Date(t0.getTime() + 62_000))).toBe(true);
    expect(await verifyLoginCode(db, kode2, new Date(t0.getTime() + 63_000))).toBe(false); // sekali pakai
    for (let i = 2; i < 5; i++) await requestLoginCode(db, new Date(t0.getTime() + i * 61_000));
    await expect(requestLoginCode(db, new Date(t0.getTime() + 6 * 61_000))).rejects.toThrow(/Terlalu sering/);
  });
});

describe("izin file di server bersama", () => {
  it("folder data jadi 700 & file 600; folder proyek tidak pernah dirapatkan", () => {
    if (process.platform === "win32") return;
    const akar = fs.mkdtempSync(path.join(os.tmpdir(), "dk-izin-"));
    fs.mkdirSync(path.join(akar, "data/backups"), { recursive: true });
    fs.mkdirSync(path.join(akar, "prisma"));
    fs.writeFileSync(path.join(akar, "data/dompetkos.db"), "x", { mode: 0o644 });
    fs.writeFileSync(path.join(akar, ".env"), "A=1", { mode: 0o644 });
    fs.writeFileSync(path.join(akar, "prisma/schema.prisma"), "x", { mode: 0o644 });
    fs.chmodSync(path.join(akar, "data"), 0o755);
    const lama = { db: process.env.DATABASE_URL, b: process.env.BACKUP_DIR, w: process.env.WA_SESSION_DIR, a: process.env.AI_CONFIG_DIR };
    const umask = process.umask();
    try {
      process.env.DATABASE_URL = "file:../data/dompetkos.db";
      process.env.BACKUP_DIR = "./data/backups";
      process.env.WA_SESSION_DIR = "./data/wa-session";
      process.env.AI_CONFIG_DIR = "./data/claude-config";
      expect(berkasTerbuka(akar).sort()).toEqual([".env", "data"]);
      kunciBerkas(akar);
      const mode = (p: string) => fs.statSync(path.join(akar, p)).mode & 0o777;
      expect(mode("data")).toBe(0o700);
      expect(mode("data/dompetkos.db")).toBe(0o600);
      expect(mode(".env")).toBe(0o600);
      expect(mode("prisma/schema.prisma")).toBe(0o644);
      expect(berkasTerbuka(akar)).toEqual([]);

      // DATABASE_URL di folder proyek: hanya file database yang dirapatkan, bukan seluruh proyek
      fs.writeFileSync(path.join(akar, "dev.db"), "x", { mode: 0o644 });
      process.env.DATABASE_URL = "file:../dev.db";
      kunciBerkas(akar);
      expect(mode("dev.db")).toBe(0o600);
      expect(mode("prisma/schema.prisma")).toBe(0o644);
    } finally {
      process.umask(umask);
      process.env.DATABASE_URL = lama.db;
      process.env.BACKUP_DIR = lama.b;
      process.env.WA_SESSION_DIR = lama.w;
      process.env.AI_CONFIG_DIR = lama.a;
      fs.rmSync(akar, { recursive: true, force: true });
    }
  });
});

describe("input dari luar", () => {
  it("CSRF: hanya permintaan dari situs sendiri", () => {
    const req = (h: Record<string, string>) => new Request("http://x/api/wa/logout", { method: "POST", headers: h });
    expect(asalSama(req({ origin: "http://localhost:3000", host: "localhost:3000" }))).toBe(true);
    expect(asalSama(req({ origin: "https://jahat.example", host: "localhost:3000" }))).toBe(false);
    expect(asalSama(req({ host: "localhost:3000" }))).toBe(false);
  });

  it("upload: dikenali dari isi file, bukan nama", () => {
    expect(jenisGambar(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe("jpg");
    expect(jenisGambar(Buffer.from("<script>alert(1)</script>"))).toBeNull();
    expect(jenisGambar(Buffer.from("x"))).toBeNull();
  });

  it("Claude hanya boleh membaca folder foto; permintaan lain otomatis ditolak", () => {
    const a = argumen({ system: "s", prompt: "p", model: "sonnet", gambar: "/tmp/x/foto.jpg" });
    expect(a[a.indexOf("--allowedTools") + 1]).toBe("Read(./**)");
    expect(a[a.indexOf("--permission-mode") + 1]).toBe("dontAsk");
  });

  it("pesan WhatsApp raksasa dipotong sebelum diproses", async () => {
    await handleMessage(db, { nomor: "085163544535", text: "a".repeat(50_000), now: new Date() });
    const log = await db.messageLog.findFirst({ where: { arah: "masuk" } });
    expect(log!.isi.length).toBe(4000);
  });
});
