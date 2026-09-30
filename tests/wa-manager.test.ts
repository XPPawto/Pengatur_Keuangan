import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { GatewayDriver, GatewayState, IncomingWaMessage, WaMode } from "@/lib/whatsapp/gateway";
import { WaManager } from "@/lib/whatsapp/manager";
import { seedDatabase } from "@/lib/seed";

const db = new PrismaClient();

class FakeDriver implements GatewayDriver {
  session = false;
  started: WaMode[] = [];
  stops = 0;
  logouts = 0;
  sent: { nomor: string; text: string }[] = [];
  private stateH: (s: GatewayState) => void = () => {};
  private msgH: (m: IncomingWaMessage) => void | Promise<void> = () => {};
  onState(h: (s: GatewayState) => void) { this.stateH = h; }
  onMessage(h: (m: IncomingWaMessage) => void | Promise<void>) { this.msgH = h; }
  async start(mode: WaMode) { this.started.push(mode); }
  async stop() { this.stops++; }
  async logout() { this.logouts++; this.session = false; }
  hasSession() { return this.session; }
  async sendMessage(nomor: string, text: string) { this.sent.push({ nomor, text }); }
  emit(s: GatewayState) { this.stateH(s); }
  async receive(nomor: string, text: string) { await this.msgH({ nomor, text, waktu: new Date() }); }
}

async function reset() {
  for (const t of ["waCommand", "waConnectionLog", "waConnection", "pendingAction", "messageLog", "dailyLog", "transaction", "allocation", "period", "allocationPlan", "bill", "goal", "shoppingItem", "allowedNumber", "envelope"] as const) {
    await (db[t] as unknown as { deleteMany(): Promise<unknown> }).deleteMany();
  }
  await seedDatabase(db);
}

const tunggu = () => new Promise((r) => setTimeout(r, 50));
const status = () => db.waConnection.findUniqueOrThrow({ where: { id: 1 } });

let driver: FakeDriver;
let mgr: WaManager;
beforeEach(async () => {
  await reset();
  driver = new FakeDriver();
  mgr = new WaManager(db, driver, { log: () => {} });
});
afterAll(() => db.$disconnect());

describe("WaManager (pairing & logout lewat website)", () => {
  it("tanpa sesi → status Terputus, tunggu perintah website", async () => {
    await mgr.init();
    expect((await status()).status).toBe("terputus");
    expect(driver.started).toEqual([]);
  });

  it("dengan sesi lama → sambung otomatis", async () => {
    driver.session = true;
    await mgr.init();
    expect(driver.started).toEqual([{ kind: "resume" }]);
  });

  it("connect_qr → QR tersimpan → scan → Terhubung tanpa QR tersisa", async () => {
    await mgr.init();
    await db.waCommand.create({ data: { perintah: "connect_qr" } });
    await mgr.pollOnce();
    expect(driver.started).toEqual([{ kind: "qr" }]);
    expect((await status()).status).toBe("menunggu_pairing");

    driver.emit({ status: "menunggu_pairing", qr: "2@abc,def,ghi" });
    await tunggu();
    expect((await status()).qr).toBe("2@abc,def,ghi");

    driver.emit({ status: "menunggu_pairing", qr: "2@baru,def,ghi" }); // QR diperbarui otomatis
    await tunggu();
    expect((await status()).qr).toBe("2@baru,def,ghi");

    driver.emit({ status: "terhubung", nomorBot: "628111222333" });
    await tunggu();
    const s = await status();
    expect(s).toMatchObject({ status: "terhubung", nomorBot: "628111222333", qr: null, pairingCode: null });
    expect(s.terhubungPada).not.toBeNull();
    const log = await db.waConnectionLog.findMany({ orderBy: { id: "asc" } });
    expect(log.map((l) => l.peristiwa)).toContain("terhubung");
  });

  it("connect_code → kode pairing tersimpan", async () => {
    await mgr.init();
    await db.waCommand.create({ data: { perintah: "connect_code", nomor: "0811-2223-33" } });
    await mgr.pollOnce();
    expect(driver.started).toEqual([{ kind: "code", phone: "62811222333" }]);
    driver.emit({ status: "menunggu_pairing", pairingCode: "ABCD-1234" });
    await tunggu();
    expect((await status()).pairingCode).toBe("ABCD-1234");
  });

  it("logout → sesi dilepas, status Terputus, tercatat di riwayat", async () => {
    await mgr.init();
    driver.emit({ status: "terhubung", nomorBot: "628111222333" });
    await tunggu();
    await db.waCommand.create({ data: { perintah: "logout" } });
    await mgr.pollOnce();
    expect(driver.logouts).toBe(1);
    const s = await status();
    expect(s).toMatchObject({ status: "terputus", nomorBot: null });
    expect(s.alasan).toContain("website");
    expect((await db.waConnectionLog.findMany()).map((l) => l.peristiwa)).toContain("logout");
  });

  it("putus sendiri → Terputus + alasan + riwayat", async () => {
    await mgr.init();
    driver.emit({ status: "terhubung", nomorBot: "628111222333" });
    await tunggu();
    driver.emit({ status: "terputus", alasan: "Koneksi putus (kode 408)" });
    await tunggu();
    expect(await status()).toMatchObject({ status: "terputus", alasan: "Koneksi putus (kode 408)" });
  });

  it("perintah diproses sekali saja", async () => {
    await mgr.init();
    await db.waCommand.create({ data: { perintah: "connect_qr" } });
    await mgr.pollOnce();
    await mgr.pollOnce();
    expect(driver.started).toHaveLength(1);
  });

  it("pesan dari nomor terdaftar dibalas, dari nomor asing tidak", async () => {
    await mgr.init();
    await driver.receive("6285163544535", "bantuan");
    await driver.receive("6281234567890", "bantuan");
    expect(driver.sent).toHaveLength(1);
    expect(driver.sent[0].nomor).toBe("6285163544535");
    expect(driver.sent[0].text).toContain("DompetKos");
  });
});
