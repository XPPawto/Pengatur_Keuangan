/**
 * Pembungkus koneksi WhatsApp. Logika bisnis hanya kenal `WhatsAppGateway`, jadi penyedia bisa diganti
 * (Baileys sekarang, WhatsApp Cloud API nanti) tanpa mengubah bot/service.
 */
export interface IncomingWaMessage {
  /** nomor pengirim, format internasional tanpa + (mis. 6285163544535) */
  nomor: string;
  text: string;
  waktu: Date;
  /** ada kalau pesannya gambar (mis. foto struk); dipanggil hanya saat dibutuhkan */
  gambar?: () => Promise<Buffer>;
}

export interface WhatsAppGateway {
  sendMessage(nomor: string, text: string): Promise<void>;
  onMessage(handler: (m: IncomingWaMessage) => void | Promise<void>): void;
}

export type WaStatus = "terhubung" | "terputus" | "menunggu_pairing";

export interface GatewayState {
  status: WaStatus;
  nomorBot?: string | null;
  /** string QR mentah; diubah jadi gambar oleh website */
  qr?: string | null;
  pairingCode?: string | null;
  alasan?: string | null;
}

export type WaMode = { kind: "resume" } | { kind: "qr" } | { kind: "code"; phone: string };

/** Gateway yang juga bisa dikontrol siklus hidupnya (dipakai worker & halaman Koneksi WhatsApp). */
export interface GatewayDriver extends WhatsAppGateway {
  onState(handler: (s: GatewayState) => void): void;
  start(mode: WaMode): Promise<void>;
  /** tutup socket tanpa melepas perangkat tertaut */
  stop(): Promise<void>;
  /** lepas perangkat tertaut dan hapus sesi di server */
  logout(): Promise<void>;
  hasSession(): boolean;
}
