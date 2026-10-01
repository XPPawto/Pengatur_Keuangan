"use server";

import { revalidatePath } from "next/cache";
import { requireLogin } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { AKTOR_WEB } from "@/lib/services/activity-log";
import { setSetting } from "@/lib/services/settings";
import { hapusRiwayat, ingat, jalankanAksiAI, lupakan, tanyaAsisten, validasiAksi, type AksiAI } from "@/lib/ai/asisten";
import { LABEL_KONDISI, simpanTokenAI, tesKoneksiAI } from "@/lib/ai/panggil";
import type { FormState } from "./actions";

const KANAL_WEB = "web";
const MODEL = ["sonnet", "opus", "haiku", "fable"];

export interface JawabanState {
  ok: boolean;
  balasan: string;
  aksi: AksiAI[];
  memori: string[];
}

export async function tanyaAsistenAction(pesan: string): Promise<JawabanState> {
  await requireLogin();
  const p = pesan.trim();
  if (!p) return { ok: false, balasan: "Tulis pertanyaannya dulu.", aksi: [], memori: [] };
  const r = await tanyaAsisten(prisma, { kanal: KANAL_WEB, pesan: p, now: new Date() });
  if (r.memori.length) revalidatePath("/asisten");
  return { ok: r.ok, balasan: r.balasan, aksi: r.aksi, memori: r.memori };
}

export async function jalankanAksiAction(aksiMentah: unknown): Promise<{ berhasil: string[]; gagal: string[] }> {
  await requireLogin();
  const now = new Date();
  // usulan dari browser divalidasi ulang di server sebelum dijalankan
  const aksi = await validasiAksi(prisma, aksiMentah, now);
  if (!aksi.length) return { berhasil: [], gagal: ["Usulan tidak valid atau sudah kedaluwarsa."] };
  const r = await jalankanAksiAI(prisma, aksi, AKTOR_WEB, now);
  revalidatePath("/", "layout");
  return r;
}

export async function resetObrolanAction() {
  await requireLogin();
  await hapusRiwayat(prisma, KANAL_WEB);
  revalidatePath("/asisten");
}

// ---------------------------------------------------------------- pengaturan

export async function simpanTokenAction(_: FormState, form: FormData): Promise<FormState> {
  await requireLogin();
  const token = String(form.get("token") ?? "").trim();
  if (!token) return { error: "Tempel token hasil `claude setup-token` dulu." };
  try {
    await simpanTokenAI(prisma, token);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Token tidak valid." };
  }
  const h = await tesKoneksiAI(prisma, new Date());
  revalidatePath("/", "layout");
  return h.ok ? { ok: "Token tersimpan (terenkripsi) dan koneksi ke Claude berhasil." } : { error: `Token tersimpan, tapi tes koneksi gagal: ${LABEL_KONDISI[h.alasan as keyof typeof LABEL_KONDISI] ?? h.alasan}. ${h.pesan}` };
}

export async function hapusTokenAction() {
  await requireLogin();
  await simpanTokenAI(prisma, null);
  revalidatePath("/", "layout");
}

export async function tesKoneksiAction(_: FormState): Promise<FormState> {
  await requireLogin();
  const h = await tesKoneksiAI(prisma, new Date());
  revalidatePath("/", "layout");
  if (h.ok) return { ok: `Tersambung ke Claude (${(h.durasiMs / 1000).toFixed(1)} detik).` };
  return { error: `${LABEL_KONDISI[h.alasan as keyof typeof LABEL_KONDISI] ?? "Gagal"}: ${h.pesan}` };
}

export async function simpanPengaturanAIAction(_: FormState, form: FormData): Promise<FormState> {
  await requireLogin();
  const batas = Number(form.get("ai_batas_harian"));
  if (!Number.isInteger(batas) || batas < 1 || batas > 500) return { error: "Batas harian 1–500." };
  const model = String(form.get("ai_model"));
  const ringan = String(form.get("ai_model_ringan"));
  if (!MODEL.includes(model) || !MODEL.includes(ringan)) return { error: "Model tidak dikenal." };
  const onOff = (k: string) => (form.get(k) === "on" ? "1" : "0");
  await setSetting(prisma, "ai_aktif", onOff("ai_aktif"));
  await setSetting(prisma, "ai_batas_harian", String(batas));
  await setSetting(prisma, "ai_model", model);
  await setSetting(prisma, "ai_model_ringan", ringan);
  await setSetting(prisma, "ai_pesan_bebas", onOff("ai_pesan_bebas"));
  await setSetting(prisma, "ai_struk", onOff("ai_struk"));
  await setSetting(prisma, "ai_review", onOff("ai_review"));
  await setSetting(prisma, "ai_tebak_kategori", onOff("ai_tebak_kategori"));
  revalidatePath("/", "layout");
  return { ok: "Pengaturan asisten disimpan." };
}

// ---------------------------------------------------------------- memori & kata

export async function ingatAction(_: FormState, form: FormData): Promise<FormState> {
  await requireLogin();
  try {
    const m = await ingat(prisma, String(form.get("isi") ?? ""), "pengguna");
    revalidatePath("/asisten");
    return { ok: `Diingat: ${m.isi}` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Gagal menyimpan." };
  }
}

export async function lupakanAction(form: FormData) {
  await requireLogin();
  await lupakan(prisma, Number(form.get("id")));
  revalidatePath("/asisten");
}

export async function hapusKataAction(form: FormData) {
  await requireLogin();
  await prisma.kataKategori.deleteMany({ where: { kata: String(form.get("kata")) } });
  revalidatePath("/asisten");
}
