import { ikonPng } from "@/lib/pwa/gambar";

/** /icons/192, /icons/512, /icons/maskable-512 — ikon PNG untuk manifest PWA. */
export async function GET(_: Request, { params }: { params: Promise<{ ukuran: string }> }) {
  const { ukuran } = await params;
  const m = /^(maskable-)?(192|512)$/.exec(ukuran);
  if (!m) return new Response("Tidak ada", { status: 404 });
  const res = ikonPng(Number(m[2]), m[1] ? 0.56 : 0.74);
  res.headers.set("Cache-Control", "public, max-age=604800, immutable");
  return res;
}
