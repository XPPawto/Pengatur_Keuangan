import fs from "node:fs";
import type { WASocket } from "@whiskeysockets/baileys";
import pino from "pino";
import { normalizePhone } from "../whitelist";
import type { GatewayDriver, GatewayState, IncomingWaMessage, OpsiKirim, WaMode } from "./gateway";

/** Bagian pesan Baileys yang dibaca untuk pesan grup (bentuk lengkapnya tidak perlu diketahui di sini). */
interface PesanMentah {
  key: { remoteJid?: string | null; fromMe?: boolean | null };
  pushName?: string | null;
  messageTimestamp?: unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  message?: any;
}

type Baileys = typeof import("@whiskeysockets/baileys");

const WATCHDOG_MS = 30_000;

/**
 * Driver Baileys (perangkat tertaut, tidak resmi). Pakai NOMOR CADANGAN, bukan nomor utama:
 * library tidak resmi bisa membuat nomor diblokir WhatsApp kapan saja.
 */
export class BaileysDriver implements GatewayDriver {
  private sock: WASocket | null = null;
  private stateHandlers: ((s: GatewayState) => void)[] = [];
  private msgHandlers: ((m: IncomingWaMessage) => void | Promise<void>)[] = [];
  private generation = 0;
  private mode: WaMode = { kind: "resume" };
  private reconnectTimer: NodeJS.Timeout | null = null;
  private retry = 0;

  constructor(private sessionDir: string) {}

  onState(h: (s: GatewayState) => void) {
    this.stateHandlers.push(h);
  }
  onMessage(h: (m: IncomingWaMessage) => void | Promise<void>) {
    this.msgHandlers.push(h);
  }
  private emit(s: GatewayState) {
    for (const h of this.stateHandlers) h(s);
  }

  hasSession(): boolean {
    try {
      const creds = JSON.parse(fs.readFileSync(`${this.sessionDir}/creds.json`, "utf8"));
      return creds?.registered === true;
    } catch {
      return false;
    }
  }

  async start(mode: WaMode) {
    this.mode = mode;
    this.retry = 0;
    await this.connect();
  }

  private async connect() {
    const gen = ++this.generation;
    const baileys: Baileys = await import("@whiskeysockets/baileys");
    const { state, saveCreds } = await baileys.useMultiFileAuthState(this.sessionDir);
    if (gen !== this.generation) return;

    let version: [number, number, number] | undefined;
    try {
      const latest = await Promise.race([
        baileys.fetchLatestBaileysVersion(),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 5000)),
      ]);
      version = latest.version;
    } catch {
      /* pakai versi bawaan library */
    }
    if (gen !== this.generation) return;

    const sock = baileys.makeWASocket({
      auth: state,
      version,
      logger: pino({ level: "silent" }),
      browser: baileys.Browsers.ubuntu("Chrome"),
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });
    this.sock = sock;
    let kodeDiminta = false;

    // Kalau server WhatsApp tidak menjawab sama sekali (internet mati/diblokir), jangan diam saja.
    const watchdog = setTimeout(() => {
      if (gen !== this.generation) return;
      this.emit({ status: "terputus", alasan: "Nggak bisa nyambung ke server WhatsApp. Cek koneksi internet, lalu coba lagi." });
      if (this.mode.kind === "resume") this.scheduleReconnect(gen);
      else void this.stop();
    }, WATCHDOG_MS);

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (u) => {
      if (gen !== this.generation) return;
      if (u.qr || u.connection === "open" || u.connection === "close") clearTimeout(watchdog);
      if (u.qr) {
        if (this.mode.kind === "code" && !state.creds.registered) {
          if (!kodeDiminta) {
            kodeDiminta = true;
            try {
              const code = await sock.requestPairingCode(this.mode.phone);
              this.emit({ status: "menunggu_pairing", qr: null, pairingCode: code.replace(/(.{4})(.{4})/, "$1-$2") });
            } catch (e) {
              this.emit({ status: "terputus", alasan: `Gagal minta kode pairing: ${(e as Error).message}` });
            }
          }
        } else if (this.mode.kind !== "resume") {
          this.emit({ status: "menunggu_pairing", qr: u.qr, pairingCode: null });
        }
      }
      if (u.connection === "open") {
        this.retry = 0;
        const nomorBot = sock.user?.id ? normalizePhone(sock.user.id) : null;
        this.emit({ status: "terhubung", nomorBot, qr: null, pairingCode: null });
      }
      if (u.connection === "close") {
        const code = (u.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
        if (code === baileys.DisconnectReason.loggedOut) {
          this.wipeSession();
          this.emit({ status: "terputus", nomorBot: null, alasan: "Perangkat dilepas dari HP (logged out)" });
          return;
        }
        if (code === baileys.DisconnectReason.restartRequired) {
          // normal setelah pairing berhasil: sambung ulang dengan kredensial baru
          this.mode = { kind: "resume" };
          await this.connect();
          return;
        }
        this.emit({ status: "terputus", alasan: `Koneksi putus (kode ${code ?? "?"}), mencoba menyambung lagi…` });
        this.scheduleReconnect(gen);
      }
    });

    sock.ev.on("messages.upsert", ({ messages, type }) => {
      if (type !== "notify") return;
      for (const m of messages) {
        const jid = m.key.remoteJid ?? "";
        if (m.key.fromMe || !jid || jid === "status@broadcast") continue;
        if (jid.endsWith("@g.us")) {
          const unduh = async (pesan: unknown) =>
            (await baileys.downloadMediaMessage(pesan as never, "buffer", {}, { logger: pino({ level: "silent" }), reuploadRequest: sock.updateMediaMessage })) as Buffer;
          this.terimaGrup(m, jid, unduh);
          continue;
        }
        const img = m.message?.imageMessage;
        const text = m.message?.conversation ?? m.message?.extendedTextMessage?.text ?? img?.caption ?? "";
        if (!text && !img) continue;
        const gambar = img
          ? async () =>
              (await baileys.downloadMediaMessage(m, "buffer", {}, { logger: pino({ level: "silent" }), reuploadRequest: sock.updateMediaMessage })) as Buffer
          : undefined;
        // JID berbentuk @lid: pakai nomor asli kalau tersedia
        const pnJid = jid.endsWith("@lid") ? (m.key as { remoteJidAlt?: string }).remoteJidAlt : jid;
        if (!pnJid) continue;
        const waktu = m.messageTimestamp ? new Date(Number(m.messageTimestamp) * 1000) : new Date();
        for (const h of this.msgHandlers) void Promise.resolve(h({ nomor: normalizePhone(pnJid), text, waktu, gambar })).catch(() => {});
      }
    });
  }

  /** Pesan grup: hanya teks. Yang memutuskan grup mana yang dilayani adalah lapisan atas (WaManager), bukan driver. */
  private terimaGrup(m: PesanMentah, jid: string, unduh: (pesan: unknown) => Promise<Buffer>) {
    const teks: string = m.message?.conversation ?? m.message?.extendedTextMessage?.text ?? m.message?.imageMessage?.caption ?? "";
    if (!teks.trim()) return;
    const kunci = m.key as { participant?: string; participantAlt?: string };
    // pengirim @lid: pakai nomor asli kalau tersedia
    const pengirim = (kunci.participant ?? "").endsWith("@lid") ? kunci.participantAlt : kunci.participant;
    if (!pengirim) return;
    const nomorDari = (j?: string | null) => (j ? j.split("@")[0].split(":")[0] : "");
    const bot = [this.sock?.user?.id, (this.sock?.user as { lid?: string } | undefined)?.lid].map(nomorDari).filter(Boolean);
    const konteks = m.message?.extendedTextMessage?.contextInfo as { mentionedJid?: string[]; participant?: string } | undefined;
    const disapa = !!konteks && ((konteks.mentionedJid ?? []).some((j) => bot.includes(nomorDari(j))) || bot.includes(nomorDari(konteks.participant)));
    const waktu = m.messageTimestamp ? new Date(Number(m.messageTimestamp) * 1000) : new Date();
    // pesan yang dibalas (teks / foto) supaya "/ai terjemahkan" bisa dipakai di atas pesan siapa pun
    const ctx = (m.message?.extendedTextMessage?.contextInfo ?? m.message?.imageMessage?.contextInfo) as
      | { quotedMessage?: Record<string, any>; stanzaId?: string; participant?: string } // eslint-disable-line @typescript-eslint/no-explicit-any
      | undefined;
    const q = ctx?.quotedMessage;
    const kutipan = q
      ? {
          teks: String(q.conversation ?? q.extendedTextMessage?.text ?? q.imageMessage?.caption ?? ""),
          dariBot: bot.includes(nomorDari(ctx?.participant)),
          gambar: q.imageMessage ? () => unduh({ key: { remoteJid: jid, id: ctx?.stanzaId, participant: ctx?.participant }, message: q }) : undefined,
        }
      : undefined;
    const pesan: IncomingWaMessage = {
      nomor: normalizePhone(pengirim),
      text: teks,
      waktu,
      // foto yang dikirim bersama /ai (caption)
      gambar: m.message?.imageMessage ? () => unduh(m) : undefined,
      grup: { jid, nama: m.pushName ?? undefined, disapa, pesan: m, kutipan },
    };
    for (const h of this.msgHandlers) void Promise.resolve(h(pesan)).catch(() => {});
  }

  private scheduleReconnect(gen: number) {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const delay = Math.min(30_000, 2000 * 2 ** this.retry++);
    this.reconnectTimer = setTimeout(() => {
      if (gen === this.generation) void this.connect().catch(() => this.scheduleReconnect(gen));
    }, delay);
  }

  private tujuan(nomor: string) {
    return nomor.includes("@") ? nomor : `${normalizePhone(nomor)}@s.whatsapp.net`;
  }

  async sendMessage(nomor: string, text: string, opsi?: OpsiKirim) {
    if (!this.sock) throw new Error("WhatsApp belum terhubung");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await this.sock.sendMessage(this.tujuan(nomor), { text }, opsi?.kutip ? { quoted: opsi.kutip as any } : undefined);
  }

  async mengetik(nomor: string) {
    await this.sock?.sendPresenceUpdate("composing", this.tujuan(nomor));
  }

  async stop() {
    this.generation++;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const s = this.sock;
    this.sock = null;
    try {
      s?.end(undefined);
    } catch {
      /* socket sudah tertutup */
    }
  }

  async logout() {
    const s = this.sock;
    this.generation++;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.sock = null;
    try {
      await s?.logout();
    } catch {
      /* sudah putus: cukup hapus sesi lokal */
    }
    this.wipeSession();
  }

  private wipeSession() {
    fs.rmSync(this.sessionDir, { recursive: true, force: true });
  }
}
