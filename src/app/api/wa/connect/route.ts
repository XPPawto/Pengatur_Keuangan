import { NextResponse } from "next/server";
import { isLoggedIn } from "@/lib/auth/session";
import { asalSama } from "@/lib/keamanan/asal";
import { prisma } from "@/lib/db";
import { isOwner, normalizePhone } from "@/lib/whitelist";

export const dynamic = "force-dynamic";

/** Minta bot worker memulai pairing: { mode: "qr" } atau { mode: "code", phone: "08..." } */
export async function POST(req: Request) {
  if (!(await isLoggedIn())) return NextResponse.json({ error: "Belum login" }, { status: 401 });
  if (!asalSama(req)) return NextResponse.json({ error: "Asal permintaan tidak sah" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { mode?: string; phone?: string };

  const conn = await prisma.waConnection.findUnique({ where: { id: 1 } });
  if (conn?.status === "terhubung") return NextResponse.json({ error: "Sudah terhubung. Putuskan dulu kalau mau ganti nomor." }, { status: 409 });

  if (body.mode === "qr") {
    await prisma.waCommand.create({ data: { perintah: "connect_qr" } });
    return NextResponse.json({ ok: true });
  }
  if (body.mode === "code") {
    const phone = normalizePhone(body.phone ?? "");
    if (!/^\d{9,15}$/.test(phone)) return NextResponse.json({ error: "Nomor bot nggak valid. Contoh: 0812xxxxxxx" }, { status: 400 });
    if (isOwner(phone)) {
      return NextResponse.json({ error: "Nomor bot harus nomor cadangan, bukan salah satu nomor penerima. Kalau nomor bot diblokir, nomor utama tetap aman." }, { status: 400 });
    }
    await prisma.waCommand.create({ data: { perintah: "connect_code", nomor: phone } });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "mode harus qr atau code" }, { status: 400 });
}
