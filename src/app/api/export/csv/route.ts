import { NextResponse } from "next/server";
import { isLoggedIn } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { buildTransactionsCsv } from "@/lib/services/export";
import { wibDate } from "@/lib/time";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isLoggedIn())) return NextResponse.json({ error: "Belum login" }, { status: 401 });
  return new NextResponse(await buildTransactionsCsv(prisma), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="dompetkos-transaksi-${wibDate(new Date())}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
