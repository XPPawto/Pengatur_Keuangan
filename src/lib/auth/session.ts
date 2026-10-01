import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "../db";
import { bacaSesi, SESSION_COOKIE } from "./token";

// ---------------------------------------------------------------- versi sesi (cabut semua sesi)

let cacheVersi: { nilai: number; sampai: number } | null = null;

/** Versi sesi yang berlaku sekarang (Setting "sesi_versi", di-cache 3 detik). */
export async function versiSesi(): Promise<number> {
  const kini = Date.now();
  if (cacheVersi && cacheVersi.sampai > kini) return cacheVersi.nilai;
  const row = await prisma.setting.findUnique({ where: { kunci: "sesi_versi" } }).catch(() => null);
  const nilai = Number(row?.nilai ?? 0) || 0;
  cacheVersi = { nilai, sampai: kini + 3000 };
  return nilai;
}

/** Semua sesi yang sudah ada jadi tidak berlaku (semua perangkat harus login ulang). */
export async function cabutSemuaSesi(): Promise<number> {
  const baru = (await versiSesi()) + 1;
  await prisma.setting.upsert({ where: { kunci: "sesi_versi" }, update: { nilai: String(baru) }, create: { kunci: "sesi_versi", nilai: String(baru) } });
  cacheVersi = null;
  return baru;
}

export async function isLoggedIn(): Promise<boolean> {
  const jar = await cookies();
  const isi = await bacaSesi(process.env.SESSION_SECRET, jar.get(SESSION_COOKIE)?.value);
  return !!isi && isi.v === (await versiSesi());
}

/** Dipakai di server action / route handler sebagai lapis kedua setelah middleware. */
export async function requireLogin(): Promise<void> {
  if (!(await isLoggedIn())) redirect("/login");
}

// ---------------------------------------------------------------- pembatasan percobaan login

const JENDELA_MS = 15 * 60_000;
const MAKS_PER_IP = 5;
const MAKS_GLOBAL = 20;
const gagalPerIp = new Map<string, number[]>();
const gagalGlobal: number[] = [];

function bersihkan(daftar: number[], now: number) {
  while (daftar.length && now - daftar[0] > JENDELA_MS) daftar.shift();
}

/** IP pengunjung (dari proxy kalau ada). Hanya dipakai untuk pembatasan, bukan untuk izin. */
export async function ipPengunjung(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] || h.get("x-real-ip") || "lokal").trim().slice(0, 64);
}

/** Maks 5 gagal per IP dan 20 gagal total per 15 menit (password & kode WA dihitung bersama). */
export function loginTerkunci(ip = "lokal", now = Date.now()): boolean {
  bersihkan(gagalGlobal, now);
  const d = gagalPerIp.get(ip) ?? [];
  bersihkan(d, now);
  return d.length >= MAKS_PER_IP || gagalGlobal.length >= MAKS_GLOBAL;
}

/** Catat gagal; mengembalikan jumlah gagal 15 menit terakhir dari IP itu. */
export function catatLoginGagal(ip = "lokal", now = Date.now()): number {
  gagalGlobal.push(now);
  const d = gagalPerIp.get(ip) ?? [];
  d.push(now);
  bersihkan(d, now);
  gagalPerIp.set(ip, d);
  if (gagalPerIp.size > 1000) gagalPerIp.delete(gagalPerIp.keys().next().value!);
  return d.length;
}

export function resetLoginGagal(ip = "lokal") {
  gagalPerIp.delete(ip);
}
