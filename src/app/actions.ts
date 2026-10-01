"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { verifyPassword } from "@/lib/auth/password";
import { cabutSemuaSesi, catatLoginGagal, ipPengunjung, loginTerkunci, requireLogin, resetLoginGagal, versiSesi } from "@/lib/auth/session";
import { catatLoginGagalKeLog, kabarLoginBaru } from "@/lib/services/keamanan";
import { SECRET_MIN, SESSION_COOKIE, SESSION_TTL_SECONDS, signSession } from "@/lib/auth/token";
import { prisma } from "@/lib/db";
import { parseAmount } from "@/lib/parser/amount";
import { AppError } from "@/lib/services/errors";
import { cancelPendingPeriod, getPendingPeriod, proposePeriod } from "@/lib/services/periods";
import { confirmPeriodAndNotify } from "@/lib/services/notify";
import { verifyLoginCode, requestLoginCode } from "@/lib/services/otp";
import { markTanpaJajan } from "@/lib/services/daily";
import { deleteTransaction, recordExpense, updateTransaction } from "@/lib/services/transactions";
import { ENVELOPE_KODE, type EnvelopeKode } from "@/lib/types";
import { rp } from "@/lib/money";
import { AKTOR_WEB, logActivity } from "@/lib/services/activity-log";
import { wibDate } from "@/lib/time";

export interface FormState {
  error?: string;
  ok?: string;
}

function pesanError(e: unknown): string {
  if (e instanceof AppError) return e.message;
  console.error(e);
  return "Ada error di server. Coba lagi.";
}

function tanggalForm(form: FormData): string | undefined {
  const t = String(form.get("tanggal") ?? "");
  return /^\d{4}-\d{2}-\d{2}$/.test(t) && t !== wibDate(new Date()) ? t : undefined;
}

function kodeValid(v: FormDataEntryValue | null): EnvelopeKode | null {
  return ENVELOPE_KODE.includes(v as EnvelopeKode) ? (v as EnvelopeKode) : null;
}

// ---------- login ----------

const TERKUNCI = "Kebanyakan percobaan gagal. Coba lagi 15 menit lagi.";

function cekSecret(): string | { error: string } {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return { error: "SESSION_SECRET belum diatur di .env. Jalankan `npm run setup`." };
  if (secret.length < SECRET_MIN) return { error: `SESSION_SECRET terlalu pendek (minimal ${SECRET_MIN} karakter). Ganti dengan string acak panjang, mis. hasil \`openssl rand -hex 32\`.` };
  return secret;
}

async function gagalMasuk(ip: string, cara: string): Promise<void> {
  const n = catatLoginGagal(ip);
  await catatLoginGagalKeLog(prisma, { ip, cara, jumlah: n, now: new Date() }).catch(() => {});
}

async function berhasilMasuk(ip: string, cara: string, secret: string): Promise<never> {
  resetLoginGagal(ip);
  await setSessionCookie(secret);
  const ua = (await headers()).get("user-agent") ?? "";
  await kabarLoginBaru(prisma, { ip, cara, ua, now: new Date() }).catch(() => {});
  redirect("/");
}

export async function login(_: FormState, form: FormData): Promise<FormState> {
  const ip = await ipPengunjung();
  if (loginTerkunci(ip)) return { error: TERKUNCI };
  const secret = cekSecret();
  if (typeof secret !== "string") return secret;
  if (!process.env.APP_PASSWORD_HASH) return { error: "Password belum diatur. Jalankan `npm run setup` (atau isi APP_PASSWORD_HASH di .env)." };
  const pw = String(form.get("password") ?? "").slice(0, 256);
  if (!verifyPassword(pw, process.env.APP_PASSWORD_HASH)) {
    await gagalMasuk(ip, "password");
    return { error: "Password salah." };
  }
  return berhasilMasuk(ip, "password", secret);
}

async function setSessionCookie(secret: string) {
  const jar = await cookies();
  const h = await headers();
  jar.set(SESSION_COOKIE, await signSession(secret, Date.now(), await versiSesi()), {
    httpOnly: true,
    sameSite: "lax",
    // otomatis secure kalau diakses lewat HTTPS (tunnel / reverse proxy)
    secure: process.env.COOKIE_SECURE === "1" || h.get("x-forwarded-proto") === "https",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function mintaKodeLogin(_: FormState): Promise<FormState> {
  const ip = await ipPengunjung();
  if (loginTerkunci(ip)) return { error: TERKUNCI };
  try {
    await requestLoginCode(prisma, new Date());
  } catch (e) {
    return { error: pesanError(e) };
  }
  return { ok: "Kode dikirim ke WhatsApp pemilik. Berlaku 5 menit." };
}

export async function loginKode(_: FormState, form: FormData): Promise<FormState> {
  const ip = await ipPengunjung();
  if (loginTerkunci(ip)) return { error: TERKUNCI };
  const secret = cekSecret();
  if (typeof secret !== "string") return secret;
  if (!(await verifyLoginCode(prisma, String(form.get("kode") ?? "").slice(0, 32), new Date()))) {
    await gagalMasuk(ip, "kode WhatsApp");
    return { error: "Kode salah atau sudah kedaluwarsa." };
  }
  return berhasilMasuk(ip, "kode WhatsApp", secret);
}

export async function logout() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}

/** Cabut semua sesi (semua HP/laptop harus login ulang), termasuk perangkat ini. */
export async function keluarSemuaPerangkat() {
  await requireLogin();
  await cabutSemuaSesi();
  await logActivity(prisma, AKTOR_WEB, "keluar_semua", "Keluar dari semua perangkat (semua sesi dicabut)", { now: new Date() });
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}

// ---------- pengeluaran ----------

export async function catatPengeluaran(_: FormState, form: FormData): Promise<FormState> {
  await requireLogin();
  const nominal = parseAmount(String(form.get("nominal") ?? ""));
  const kode = kodeValid(form.get("kode"));
  if (!nominal) return { error: "Nominal nggak kebaca. Contoh: 12k, 12rb, 12.000." };
  if (!kode) return { error: "Pilih amplopnya dulu." };
  try {
    await recordExpense(prisma, {
      kode,
      nominal,
      catatan: String(form.get("catatan") ?? ""),
      sumber: "web",
      now: new Date(),
      konfirmasiBukaKunci: String(form.get("konfirmasi") ?? ""),
      tanggal: tanggalForm(form),
    });
  } catch (e) {
    return { error: pesanError(e) };
  }
  revalidatePath("/", "layout");
  return { ok: `Tercatat: ${String(form.get("catatan") ?? "").trim() || "pengeluaran"} ${rp(nominal)}.` };
}

export async function tandaiTanpaJajan() {
  await requireLogin();
  await markTanpaJajan(prisma, new Date());
  revalidatePath("/", "layout");
}

export async function ubahTransaksi(_: FormState, form: FormData): Promise<FormState> {
  await requireLogin();
  const id = Number(form.get("id"));
  const nominal = parseAmount(String(form.get("nominal") ?? ""));
  const kode = kodeValid(form.get("kode"));
  if (!nominal) return { error: "Nominal nggak valid." };
  try {
    await updateTransaction(
      prisma,
      id,
      { nominal, catatan: String(form.get("catatan") ?? ""), kode: kode ?? undefined, konfirmasiBukaKunci: String(form.get("konfirmasi") ?? "") },
      new Date(),
    );
  } catch (e) {
    return { error: pesanError(e) };
  }
  revalidatePath("/", "layout");
  return { ok: "Tersimpan." };
}

export async function hapusTransaksi(form: FormData) {
  await requireLogin();
  await deleteTransaction(prisma, Number(form.get("id")), new Date()).catch(() => {});
  revalidatePath("/", "layout");
}

// ---------- uang masuk ----------

export async function usulkanUangMasuk(_: FormState, form: FormData): Promise<FormState> {
  await requireLogin();
  const nominal = parseAmount(String(form.get("nominal") ?? ""));
  if (!nominal) return { error: "Nominal nggak kebaca. Contoh: 300k atau 300.000." };
  try {
    await proposePeriod(prisma, nominal, new Date());
  } catch (e) {
    return { error: e instanceof AppError && e.code === "period_exists" ? "Periode minggu ini sudah jalan. Uang ekstra dicatat lewat WhatsApp (`masuk 40`)." : pesanError(e) };
  }
  revalidatePath("/", "layout");
  return {};
}

export async function konfirmasiUangMasuk() {
  await requireLogin();
  const p = await getPendingPeriod(prisma);
  if (p) await confirmPeriodAndNotify(prisma, p.id, new Date()).catch(() => {});
  revalidatePath("/", "layout");
}

export async function batalkanUangMasuk() {
  await requireLogin();
  const p = await getPendingPeriod(prisma);
  if (p) await cancelPendingPeriod(prisma, p.id);
  revalidatePath("/", "layout");
}
