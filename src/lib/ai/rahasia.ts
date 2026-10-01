import crypto from "node:crypto";

/**
 * Enkripsi token Claude yang disimpan di database (AES-256-GCM, kunci diturunkan dari SESSION_SECRET).
 * Tujuannya: file database / backup yang bocor tidak langsung membuka akun Claude pemilik.
 */
function kunci(): Buffer {
  return crypto.createHash("sha256").update(`dompetkos-ai:${process.env.SESSION_SECRET ?? ""}`).digest();
}

export function enkripsi(teks: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", kunci(), iv);
  const data = Buffer.concat([c.update(teks, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), data.toString("base64")].join(":");
}

/** null kalau rusak atau SESSION_SECRET sudah berganti. */
export function dekripsi(simpan: string): string | null {
  const [v, iv, tag, data] = simpan.split(":");
  if (v !== "v1" || !iv || !tag || !data) return null;
  try {
    const d = crypto.createDecipheriv("aes-256-gcm", kunci(), Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Tampilan aman: hanya 4 karakter terakhir. */
export function samarkan(token: string): string {
  return `••••${token.slice(-4)}`;
}
