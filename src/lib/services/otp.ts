import { createHash, randomInt } from "node:crypto";
import type { Db } from "../db";
import { AppError } from "./errors";
import { enqueue } from "./outbox";
import { recipientsFor } from "./recipients";
import { getSetting } from "./settings";

const BERLAKU_MS = 5 * 60_000;
const JEDA_MS = 60_000;

function hash(kode: string) {
  return createHash("sha256").update(`${process.env.SESSION_SECRET ?? ""}:${kode}`).digest("hex");
}

/** Kirim kode login 6 digit ke nomor pemilik lewat WhatsApp. */
export async function requestLoginCode(db: Db, now: Date): Promise<void> {
  if ((await getSetting(db, "otp_login")) !== "1") throw new AppError("invalid", "Login pakai kode WhatsApp dimatikan di Pengaturan.");
  const conn = await db.waConnection.findUnique({ where: { id: 1 } });
  if (conn?.status !== "terhubung") throw new AppError("invalid", "WhatsApp bot belum terhubung. Login pakai password dulu.");
  const last = await db.loginCode.findFirst({ orderBy: { id: "desc" } });
  if (last && now.getTime() - last.dibuatPada.getTime() < JEDA_MS) throw new AppError("invalid", "Tunggu 1 menit sebelum minta kode lagi.");

  const sejamLalu = new Date(now.getTime() - 3600_000);
  if ((await db.loginCode.count({ where: { dibuatPada: { gte: sejamLalu } } })) >= 5) throw new AppError("invalid", "Terlalu sering minta kode. Coba lagi 1 jam lagi atau login pakai password.");
  // kode lama yang belum dipakai langsung hangus: hanya satu kode yang berlaku pada satu waktu
  await db.loginCode.updateMany({ where: { dipakai: false }, data: { dipakai: true } });

  const kode = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db.loginCode.create({ data: { kodeHash: hash(kode), kedaluwarsa: new Date(now.getTime() + BERLAKU_MS), dibuatPada: now } });
  const isi = `Kode login DompetKos: *${kode}*\nBerlaku 5 menit. Jangan kasih ke siapa pun. Kalau lo nggak minta, abaikan aja.`;
  for (const nomor of await recipientsFor(db, "pemilik")) await enqueue(db, { nomor, jenis: "otp", isi }, now);
}

export async function verifyLoginCode(db: Db, kode: string, now: Date): Promise<boolean> {
  const bersih = kode.replace(/\D/g, "");
  if (bersih.length !== 6) return false;
  const row = await db.loginCode.findFirst({ where: { kodeHash: hash(bersih), dipakai: false, kedaluwarsa: { gt: now } } });
  if (!row) return false;
  await db.loginCode.update({ where: { id: row.id }, data: { dipakai: true } });
  return true;
}
