/**
 * Token sesi bertanda tangan HMAC-SHA256 (Web Crypto, jalan di middleware Edge maupun Node).
 * Format: base64url(payload JSON) + "." + base64url(tanda tangan)
 */
export const SESSION_COOKIE = "dk_session";
export const SESSION_TTL_SECONDS = 30 * 24 * 3600;
/** SESSION_SECRET lebih pendek dari ini ditolak (kunci lemah bisa ditebak lalu sesi dipalsukan). */
export const SECRET_MIN = 32;

export interface IsiSesi {
  exp: number;
  /** versi sesi; dinaikkan oleh "Keluar dari semua perangkat" supaya sesi lama tidak berlaku */
  v: number;
}

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function key(secret: string) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signSession(secret: string, now = Date.now(), v = 0): Promise<string> {
  if (secret.length < SECRET_MIN) throw new Error(`SESSION_SECRET minimal ${SECRET_MIN} karakter.`);
  const payload = b64url(enc.encode(JSON.stringify({ exp: Math.floor(now / 1000) + SESSION_TTL_SECONDS, v })));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await key(secret), enc.encode(payload)));
  return `${payload}.${b64url(sig)}`;
}

/** Isi sesi kalau tanda tangan sah & belum kedaluwarsa; null kalau tidak. */
export async function bacaSesi(secret: string | undefined, token: string | undefined, now = Date.now()): Promise<IsiSesi | null> {
  if (!secret || secret.length < SECRET_MIN || !token || token.length > 512) return null;
  const [payload, sig, lebih] = token.split(".");
  if (!payload || !sig || lebih !== undefined) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await key(secret), fromB64url(sig) as BufferSource, enc.encode(payload));
    if (!ok) return null;
    const isi = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as Partial<IsiSesi>;
    if (typeof isi.exp !== "number" || isi.exp * 1000 <= now) return null;
    return { exp: isi.exp, v: typeof isi.v === "number" ? isi.v : 0 };
  } catch {
    return null;
  }
}

export async function verifySession(secret: string | undefined, token: string | undefined, now = Date.now()): Promise<boolean> {
  return (await bacaSesi(secret, token, now)) !== null;
}
