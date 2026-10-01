import { NextResponse, type NextRequest } from "next/server";
import { isLoggedIn } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { denyutKoneksi } from "@/lib/services/koneksi";

export const dynamic = "force-dynamic";

const angka = (v: string | null) => (v !== null && /^\d+$/.test(v) ? Number(v) : undefined);

/** Aktivitas langsung untuk animasi peta koneksi (dipoll tiap ±1,5 detik). Tanpa isi pesan. */
export async function GET(req: NextRequest) {
  if (!(await isLoggedIn())) return NextResponse.json({ error: "Belum login" }, { status: 401 });
  const q = req.nextUrl.searchParams;
  const cek = (q.get("cek") ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0);
  return NextResponse.json(await denyutKoneksi(prisma, new Date(), { pesan: angka(q.get("p")), ai: angka(q.get("a")), cek }));
}
