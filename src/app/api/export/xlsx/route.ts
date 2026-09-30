import { NextResponse } from "next/server";
import { isLoggedIn } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { buildWorkbook } from "@/lib/services/export";
import { wibDate } from "@/lib/time";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isLoggedIn())) return NextResponse.json({ error: "Belum login" }, { status: 401 });
  const now = new Date();
  const buf = await buildWorkbook(prisma, now);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="dompetkos-${wibDate(now)}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
