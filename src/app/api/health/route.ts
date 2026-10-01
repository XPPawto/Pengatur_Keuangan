import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Cek hidup untuk monitor uptime. Publik, tanpa data pribadi. */
export async function GET() {
  try {
    const c = await prisma.waConnection.findUnique({ where: { id: 1 } });
    const bot = !!c?.workerPing && Date.now() - c.workerPing.getTime() < 60_000;
    return NextResponse.json({ ok: true, web: true, bot, whatsapp: c?.status === "terhubung" });
  } catch {
    return NextResponse.json({ ok: false, web: true, db: false }, { status: 503 });
  }
}
