"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { verifyPassword } from "@/lib/auth/password";
import { catatLoginGagal, loginTerkunci, requireLogin, resetLoginGagal } from "@/lib/auth/session";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, signSession } from "@/lib/auth/token";
import { prisma } from "@/lib/db";
import { parseAmount } from "@/lib/parser/amount";
import { AppError } from "@/lib/services/errors";
import { cancelPendingPeriod, confirmPeriod, getPendingPeriod, proposePeriod } from "@/lib/services/periods";
import { markTanpaJajan } from "@/lib/services/daily";
import { deleteTransaction, recordExpense, updateTransaction } from "@/lib/services/transactions";
import { ENVELOPE_KODE, type EnvelopeKode } from "@/lib/types";

export interface FormState {
  error?: string;
  ok?: string;
}

function pesanError(e: unknown): string {
  if (e instanceof AppError) return e.message;
  console.error(e);
  return "Ada error di server. Coba lagi.";
}

function kodeValid(v: FormDataEntryValue | null): EnvelopeKode | null {
  return ENVELOPE_KODE.includes(v as EnvelopeKode) ? (v as EnvelopeKode) : null;
}

// ---------- login ----------

export async function login(_: FormState, form: FormData): Promise<FormState> {
  if (loginTerkunci()) return { error: "Kebanyakan salah. Coba lagi 15 menit lagi." };
  const secret = process.env.SESSION_SECRET;
  if (!secret || !process.env.APP_PASSWORD_HASH) {
    return { error: "Password belum diatur. Jalankan `npm run setup` (atau isi APP_PASSWORD_HASH dan SESSION_SECRET di .env)." };
  }
  const pw = String(form.get("password") ?? "");
  if (!verifyPassword(pw, process.env.APP_PASSWORD_HASH)) {
    catatLoginGagal();
    return { error: "Password salah." };
  }
  resetLoginGagal();
  const jar = await cookies();
  jar.set(SESSION_COOKIE, await signSession(secret), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "1",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  redirect("/");
}

export async function logout() {
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
    });
  } catch (e) {
    return { error: pesanError(e) };
  }
  revalidatePath("/", "layout");
  return { ok: `Tercatat ${String(form.get("catatan") ?? "").trim() || "pengeluaran"}.` };
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
  if (p) await confirmPeriod(prisma, p.id, new Date()).catch(() => {});
  revalidatePath("/", "layout");
}

export async function batalkanUangMasuk() {
  await requireLogin();
  const p = await getPendingPeriod(prisma);
  if (p) await cancelPendingPeriod(prisma, p.id);
  revalidatePath("/", "layout");
}
