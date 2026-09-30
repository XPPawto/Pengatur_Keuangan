import { NextResponse } from "next/server";
import { isLoggedIn } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Minta bot worker melepas perangkat tertaut dan menghapus sesi. */
export async function POST() {
  if (!(await isLoggedIn())) return NextResponse.json({ error: "Belum login" }, { status: 401 });
  await prisma.waCommand.create({ data: { perintah: "logout" } });
  return NextResponse.json({ ok: true });
}
