import type { Db } from "../db";
import { wibDate, wibHM } from "../time";
import { logActivity } from "./activity-log";
import { enqueue } from "./outbox";
import { recipientsFor } from "./recipients";

const AKTOR_SISTEM = { oleh: "sistem", sumber: "sistem" } as const;

function jam(now: Date) {
  const { jam, menit } = wibHM(now);
  return `${String(jam).padStart(2, "0")}.${String(menit).padStart(2, "0")}`;
}

/** Nama perangkat singkat dari user-agent (tanpa detail yang bisa dipakai melacak). */
export function namaPerangkat(ua: string): string {
  const os = /android/i.test(ua) ? "Android" : /iphone|ipad/i.test(ua) ? "iPhone/iPad" : /windows/i.test(ua) ? "Windows" : /mac os/i.test(ua) ? "Mac" : /linux/i.test(ua) ? "Linux" : "perangkat tak dikenal";
  const br = /edg\//i.test(ua) ? "Edge" : /firefox/i.test(ua) ? "Firefox" : /chrome|crios/i.test(ua) ? "Chrome" : /safari/i.test(ua) ? "Safari" : "browser";
  return `${br} di ${os}`;
}

async function kabari(db: Db, isi: string, kunci: string, now: Date) {
  for (const nomor of await recipientsFor(db, "pemilik")) await enqueue(db, { nomor, jenis: "keamanan", isi, kunci: `${kunci}:${nomor}` }, now);
}

/** Login website berhasil: catat & kabari pemilik lewat WhatsApp (langsung, tidak menunggu jam tenang). */
export async function kabarLoginBaru(db: Db, p: { ip: string; cara: string; ua: string; now: Date }) {
  const perangkat = namaPerangkat(p.ua);
  await logActivity(db, AKTOR_SISTEM, "login", `Login website (${p.cara}) dari ${perangkat}, IP ${p.ip}`, { now: p.now });
  const isi = [
    `*Login baru ke website DompetKos*`,
    `${jam(p.now)} WIB · ${perangkat} · lewat ${p.cara} · IP ${p.ip}`,
    "",
    "Bukan lo? Buka website → Pengaturan → *Keluar dari semua perangkat*, lalu ganti password (`npm run set-password`).",
  ].join("\n");
  await kabari(db, isi, `login:${p.now.getTime()}`, p.now);
}

/** Login gagal: dicatat; saat mencapai 5 kali dari satu IP, pemilik dikabari (sekali per jam per IP). */
export async function catatLoginGagalKeLog(db: Db, p: { ip: string; cara: string; jumlah: number; now: Date }) {
  await logActivity(db, AKTOR_SISTEM, "login_gagal", `Login gagal (${p.cara}) dari IP ${p.ip}`, { now: p.now });
  if (p.jumlah !== 5) return;
  const isi = [
    "*Peringatan keamanan DompetKos*",
    `Ada 5 percobaan login gagal ke website dari IP ${p.ip} (terakhir ${jam(p.now)} WIB). Login dari IP itu dikunci 15 menit.`,
    "",
    "Kalau itu bukan lo, ganti password website dan jangan bagikan alamat websitenya.",
  ].join("\n");
  await kabari(db, isi, `login_gagal:${p.ip}:${wibDate(p.now)}:${wibHM(p.now).jam}`, p.now);
}
