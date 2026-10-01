import { NextResponse } from "next/server";
import { isLoggedIn } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { dataKoneksi } from "@/lib/services/koneksi";

export const dynamic = "force-dynamic";

/** Potret koneksi WhatsApp + Claude untuk peta di halaman Koneksi (dipoll tiap 5 detik). */
export async function GET() {
  if (!(await isLoggedIn())) return NextResponse.json({ error: "Belum login" }, { status: 401 });
  return NextResponse.json(await dataKoneksi(prisma, new Date()));
}
