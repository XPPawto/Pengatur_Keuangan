import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, verifySession } from "./token";

export async function isLoggedIn(): Promise<boolean> {
  const jar = await cookies();
  return verifySession(process.env.SESSION_SECRET, jar.get(SESSION_COOKIE)?.value);
}

/** Dipakai di server action / route handler sebagai lapis kedua setelah middleware. */
export async function requireLogin(): Promise<void> {
  if (!(await isLoggedIn())) redirect("/login");
}

/** Rate limit login sederhana di memori: maksimal 5 gagal per 15 menit. */
const gagal: number[] = [];
export function loginTerkunci(now = Date.now()): boolean {
  while (gagal.length && now - gagal[0] > 15 * 60_000) gagal.shift();
  return gagal.length >= 5;
}
export function catatLoginGagal(now = Date.now()) {
  gagal.push(now);
}
export function resetLoginGagal() {
  gagal.length = 0;
}
