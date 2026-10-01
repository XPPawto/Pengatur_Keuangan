/** Kenali gambar dari isi file (magic bytes), bukan dari nama/tipe kiriman browser yang bisa dipalsukan. */
export function jenisGambar(b: Buffer): "jpg" | "png" | "webp" | "gif" | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  if (b.subarray(0, 4).toString("latin1") === "GIF8") return "gif";
  return null;
}

export const MAKS_GAMBAR = 8 * 1024 * 1024;
