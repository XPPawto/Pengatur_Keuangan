import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { isLoggedIn } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { isOwner } from "@/lib/whitelist";

export const dynamic = "force-dynamic";

/** Status koneksi + QR (sebagai gambar) + kode pairing + riwayat. Dipoll website tiap 2 detik. */
export async function GET() {
  if (!(await isLoggedIn())) return NextResponse.json({ error: "Belum login" }, { status: 401 });
  const [c, log, pending] = await Promise.all([
    prisma.waConnection.findUnique({ where: { id: 1 } }),
    prisma.waConnectionLog.findMany({ orderBy: { id: "desc" }, take: 15 }),
    prisma.waCommand.count({ where: { diprosesPada: null } }),
  ]);
  const qrDataUrl = c?.qr ? await QRCode.toDataURL(c.qr, { margin: 1, width: 288, errorCorrectionLevel: "M" }) : null;
  const botHidup = !!c?.workerPing && Date.now() - c.workerPing.getTime() < 30_000;
  return NextResponse.json({
    status: c?.status ?? "terputus",
    nomorBot: c?.nomorBot ?? null,
    terhubungPada: c?.terhubungPada ?? null,
    terputusPada: c?.terputusPada ?? null,
    alasan: c?.alasan ?? null,
    qrDataUrl,
    pairingCode: c?.pairingCode ?? null,
    botHidup,
    perintahMenunggu: pending,
    nomorBotSamaDenganPenerima: c?.nomorBot ? isOwner(c.nomorBot) : false,
    riwayat: log.map((l) => ({ id: l.id, peristiwa: l.peristiwa, alasan: l.alasan, waktu: l.waktu })),
  });
}
