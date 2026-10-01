import type { PrismaClient } from "@prisma/client";
import { handleMessage } from "../bot/handler";
import { isOwner, normalizePhone } from "../whitelist";
import type { GatewayDriver, GatewayState, IncomingWaMessage } from "./gateway";

/**
 * Menghubungkan driver WhatsApp dengan database:
 * - perintah dari website (tabel wa_command) → dijalankan ke driver
 * - status/QR/kode pairing dari driver → disimpan ke wa_connection (dibaca website)
 * - pesan masuk → handler bot → balasan
 */
export class WaManager {
  private timer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private lastStatus: string | null = null;
  private busy = false;

  constructor(
    private db: PrismaClient,
    private driver: GatewayDriver,
    private opts: { pollMs?: number; log?: (msg: string) => void; jedaBalasMs?: number } = {},
  ) {}

  private log(msg: string) {
    (this.opts.log ?? console.log)(`[wa] ${msg}`);
  }

  async init() {
    const row = await this.db.waConnection.upsert({ where: { id: 1 }, update: {}, create: { id: 1, status: "terputus" } });
    this.lastStatus = row.status;
    this.driver.onState((s) => void this.applyState(s).catch((e) => this.log(`gagal simpan status: ${e}`)));
    this.driver.onMessage((m) => this.onIncoming(m));
    // Sesi lama yang masih ada → sambung otomatis; kalau tidak, tunggu perintah dari website.
    if (this.driver.hasSession()) {
      await this.driver.start({ kind: "resume" });
    } else {
      await this.applyState({ status: "terputus", nomorBot: null, qr: null, pairingCode: null, alasan: "Belum pernah dipasangkan" });
    }
  }

  startPolling() {
    const ms = this.opts.pollMs ?? 1500;
    this.timer = setInterval(() => void this.pollOnce().catch((e) => this.log(`poll error: ${e}`)), ms);
    void this.ping();
    this.pingTimer = setInterval(() => void this.ping(), 10_000);
  }

  stopPolling() {
    if (this.timer) clearInterval(this.timer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.timer = null;
    this.pingTimer = null;
  }

  isConnected(): boolean {
    return this.lastStatus === "terhubung";
  }

  async send(nomor: string, text: string) {
    await this.driver.sendMessage(nomor, text);
  }

  /** Detak supaya website tahu proses bot masih hidup. */
  async ping() {
    await this.db.waConnection.update({ where: { id: 1 }, data: { workerPing: new Date() } }).catch(() => {});
  }

  /** Jalankan perintah dari website yang belum diproses. */
  async pollOnce() {
    if (this.busy) return;
    this.busy = true;
    try {
      const cmds = await this.db.waCommand.findMany({ where: { diprosesPada: null }, orderBy: { id: "asc" } });
      for (const c of cmds) {
        await this.db.waCommand.update({ where: { id: c.id }, data: { diprosesPada: new Date() } });
        await this.jalankan(c.perintah, c.nomor);
      }
    } finally {
      this.busy = false;
    }
  }

  private async jalankan(perintah: string, nomor: string | null) {
    const sekarang = await this.db.waConnection.findUnique({ where: { id: 1 } });
    switch (perintah) {
      case "connect_qr":
      case "connect_code": {
        if (sekarang?.status === "terhubung") return this.log("sudah terhubung, perintah connect diabaikan");
        await this.driver.stop();
        if (perintah === "connect_qr") {
          await this.applyState({ status: "menunggu_pairing", qr: null, pairingCode: null, alasan: null });
          await this.driver.start({ kind: "qr" });
        } else {
          const phone = normalizePhone(nomor ?? "");
          if (!phone) return this.log("connect_code tanpa nomor, diabaikan");
          await this.applyState({ status: "menunggu_pairing", qr: null, pairingCode: null, alasan: null });
          await this.driver.start({ kind: "code", phone });
        }
        return;
      }
      case "logout":
        await this.driver.logout();
        await this.applyState({ status: "terputus", nomorBot: null, qr: null, pairingCode: null, alasan: "Diputuskan dari website" }, "logout");
        return;
      default:
        this.log(`perintah tidak dikenal: ${perintah}`);
    }
  }

  async applyState(s: GatewayState, peristiwa?: string) {
    const now = new Date();
    const prev = this.lastStatus;
    this.lastStatus = s.status;
    const data: Record<string, unknown> = { status: s.status, updatedAt: now };
    if (s.nomorBot !== undefined) data.nomorBot = s.nomorBot;
    data.qr = s.status === "menunggu_pairing" ? (s.qr ?? null) : null;
    data.pairingCode = s.status === "menunggu_pairing" ? (s.pairingCode ?? null) : null;
    if (s.status === "terhubung") {
      data.terhubungPada = now;
      data.alasan = null;
    } else if (s.status === "terputus") {
      data.terputusPada = now;
      if (s.alasan !== undefined) data.alasan = s.alasan;
    } else {
      data.alasan = s.alasan ?? null;
    }
    await this.db.waConnection.upsert({ where: { id: 1 }, update: data, create: { id: 1, status: s.status, ...data } });

    if (prev !== s.status || peristiwa) {
      const tipe = peristiwa ?? (s.status === "menunggu_pairing" ? "pairing" : s.status);
      if (!(prev === "terputus" && s.status === "terputus" && !peristiwa)) {
        await this.db.waConnectionLog.create({ data: { peristiwa: tipe, alasan: s.alasan ?? null, waktu: now } });
      }
    }

    if (s.status === "terhubung" && s.nomorBot && isOwner(s.nomorBot)) {
      this.log("PERINGATAN: nomor bot sama dengan salah satu nomor penerima. Pakai nomor cadangan!");
    }
  }

  private async onIncoming(m: IncomingWaMessage) {
    try {
      const replies = await handleMessage(this.db, { nomor: m.nomor, text: m.text, now: m.waktu, gambar: m.gambar });
      for (const r of replies) {
        await this.driver.sendMessage(m.nomor, r);
        if (this.opts.jedaBalasMs) await new Promise((res) => setTimeout(res, this.opts.jedaBalasMs));
      }
    } catch (e) {
      this.log(`gagal memproses pesan: ${e}`);
    }
  }
}
