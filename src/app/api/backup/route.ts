import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { isLoggedIn } from "@/lib/auth/session";
import { BACKUP_DIR, listBackups } from "@/lib/services/backup";

export const dynamic = "force-dynamic";

/** Unduh salah satu file backup (hanya nama dari daftar backup, tidak bisa path lain). */
export async function GET(req: Request) {
  if (!(await isLoggedIn())) return NextResponse.json({ error: "Belum login" }, { status: 401 });
  const nama = new URL(req.url).searchParams.get("nama") ?? "";
  const ada = listBackups().find((b) => b.nama === nama);
  if (!ada) return NextResponse.json({ error: "Backup tidak ditemukan" }, { status: 404 });
  const buf = fs.readFileSync(path.join(BACKUP_DIR, ada.nama));
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.sqlite3",
      "Content-Disposition": `attachment; filename="${ada.nama}"`,
      "Cache-Control": "no-store",
    },
  });
}
