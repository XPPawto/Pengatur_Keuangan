import type { NextRequest } from "next/server";
import { splashPng } from "@/lib/pwa/gambar";
import { LAYAR_IPHONE } from "@/lib/pwa/layar";

/** /splash?w=1170&h=2532&tema=gelap — layar pembuka iOS. Hanya ukuran iPhone yang dikenal. */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const w = Number(q.get("w"));
  const h = Number(q.get("h"));
  if (!LAYAR_IPHONE.some((l) => l.w * l.s === w && l.h * l.s === h)) return new Response("Ukuran tidak dikenal", { status: 404 });
  const res = splashPng(w, h, q.get("tema") === "gelap");
  res.headers.set("Cache-Control", "public, max-age=604800, immutable");
  return res;
}
