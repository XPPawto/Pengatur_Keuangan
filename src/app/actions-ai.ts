"use server";

import { revalidatePath } from "next/cache";
import { requireLogin } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { AKTOR_WEB } from "@/lib/services/activity-log";
import { getSetting, setSetting } from "@/lib/services/settings";
import { hapusRiwayat, ingat, jalankanAksiAI, lupakan, tanyaAsisten, validasiAksi, type AksiAI } from "@/lib/ai/asisten";
import { cariRiwayat, token, umurLabel } from "@/lib/ai/ingatan";
import { daftarMemori, RUANG_PEMILIK, ubahMemori, type JenisMemori } from "@/lib/ai/memori";
import { jalankanRefleksi } from "@/lib/ai/refleksi";
import { undoActivity } from "@/lib/services/undo";
import { CADANGAN, LABEL_KONDISI, LABEL_PENYEDIA, labelKondisiCadangan, simpanKunciCadangan, simpanTokenAI, tesKoneksiAI, type KondisiAI, type Penyedia, type PenyediaCadangan } from "@/lib/ai/panggil";
import { modelGratis } from "@/lib/ai/openrouter";
import { modelGroqValid } from "@/lib/ai/groq";
import type { FormState } from "./actions";

const KANAL_WEB = "web";
const MODEL = ["sonnet", "opus", "haiku", "fable"];

export interface JawabanState {
  ok: boolean;
  balasan: string;
  aksi: AksiAI[];
  memori: string[];
  penyedia?: string;
  model?: string;
  /** true kalau penyedia dipilih eksplisit (bukan otomatis dengan cadangan) */
  dipilih?: boolean;
}

const PENYEDIA_BOLEH: readonly string[] = ["claude", "gemini", "openrouter", "groq"];

/** `pilih` datang dari browser: divalidasi di sini; nama model divalidasi lagi per penyedia di panggilAI. */
export async function tanyaAsistenAction(pesan: string, pilih?: { penyedia?: string; model?: string }): Promise<JawabanState> {
  await requireLogin();
  const p = pesan.trim();
  if (!p) return { ok: false, balasan: "Tulis pertanyaannya dulu.", aksi: [], memori: [] };
  const penyedia = typeof pilih?.penyedia === "string" && PENYEDIA_BOLEH.includes(pilih.penyedia) ? (pilih.penyedia as Penyedia) : undefined;
  const model = penyedia && typeof pilih?.model === "string" && pilih.model.trim() ? pilih.model.trim().slice(0, 100) : undefined;
  const r = await tanyaAsisten(prisma, { kanal: KANAL_WEB, pesan: p, now: new Date(), penyedia, model });
  if (r.memori.length) revalidatePath("/asisten");
  return { ok: r.ok, balasan: r.balasan, aksi: r.aksi, memori: r.memori, penyedia: r.penyedia, model: r.model, dipilih: !!penyedia };
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

const jenisMemori = (v: FormDataEntryValue | null): JenisMemori => (v === "profil" ? "profil" : "catatan");

export async function ingatAction(_: FormState, form: FormData): Promise<FormState> {
  await requireLogin();
  try {
    const m = await ingat(prisma, String(form.get("isi") ?? ""), "pengguna", jenisMemori(form.get("jenis")));
    revalidatePath("/asisten");
    revalidatePath("/memori");
    return { ok: `Diingat: ${m.isi}` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Gagal menyimpan." };
  }
}

export async function lupakanAction(form: FormData) {
  await requireLogin();
  await lupakan(prisma, Number(form.get("id")));
  revalidatePath("/asisten");
  revalidatePath("/memori");
}

/** Ubah isi satu memori dari halaman Memori (menunjuk entri lewat id, bukan potongan teks). */
export async function ubahMemoriAction(id: number, teks: string): Promise<{ ok: boolean; pesan: string }> {
  await requireLogin();
  const r = await ubahMemori(prisma, RUANG_PEMILIK, { aksi: "ganti", lama: "", id, teks }, "pengguna", new Date());
  if (r.ok) revalidatePath("/memori");
  return r.ok ? { ok: true, pesan: "Memori diperbarui." } : { ok: false, pesan: r.pesan };
}

/** Batalkan satu perubahan memori otomatis (dari linimasa). */
export async function batalkanMemoriAction(logId: number): Promise<{ ok: boolean; pesan: string }> {
  await requireLogin();
  try {
    const log = await undoActivity(prisma, logId, AKTOR_WEB, new Date());
    revalidatePath("/memori");
    revalidatePath("/asisten");
    return { ok: true, pesan: `Dibatalkan: ${log.ringkasan}` };
  } catch (e) {
    return { ok: false, pesan: e instanceof Error ? e.message : "Gagal membatalkan." };
  }
}

/** Minta asisten merenungkan obrolan baru sekarang juga (tanpa menunggu giliran / jeda). */
export async function renungkanAction(): Promise<{ ok: boolean; pesan: string }> {
  await requireLogin();
  const r = await jalankanRefleksi(prisma, new Date(), { paksa: true });
  revalidatePath("/memori");
  revalidatePath("/asisten");
  if (!r.jalan) return { ok: false, pesan: r.catatan ?? "Tidak jalan." };
  if (r.catatan) return { ok: false, pesan: r.catatan };
  return { ok: true, pesan: r.pesan.length ? r.pesan.join(" · ") : "Selesai merenung: tidak ada yang baru layak diingat." };
}

export async function simpanPengaturanMemoriAction(_: FormState, form: FormData): Promise<FormState> {
  await requireLogin();
  const tiap = Math.min(10, Math.max(1, Math.round(Number(form.get("memori_refleksi_tiap")) || 3)));
  await setSetting(prisma, "memori_belajar", form.get("memori_belajar") ? "1" : "0");
  await setSetting(prisma, "memori_ingatan_obrolan", form.get("memori_ingatan_obrolan") ? "1" : "0");
  await setSetting(prisma, "memori_refleksi_tiap", String(tiap));
  revalidatePath("/memori");
  return { ok: "Pengaturan memori disimpan." };
}

export interface HasilUjiIngatan {
  kata: string[];
  /** id node memori yang kata kuncinya cocok */
  memori: { id: number; isi: string; jenis: string; cocok: string[] }[];
  obrolan: { kanal: string; umur: string; tanya?: string; jawab?: string; skor: number }[];
}

/**
 * "Uji ingatan": tunjukkan apa yang akan diingat asisten kalau pesan ini dikirim: kata kunci, memori yang cocok,
 * dan potongan obrolan lama yang akan disisipkan ke prompt. Tidak memanggil AI.
 */
export async function ujiIngatanAction(query: string): Promise<HasilUjiIngatan> {
  await requireLogin();
  const now = new Date();
  const kata = token(String(query).slice(0, 500));
  const entri = await daftarMemori(prisma, RUANG_PEMILIK);
  const memori = entri
    .map((e) => {
      const t = new Set(token(e.isi));
      return { id: e.id, isi: e.isi, jenis: e.jenis, cocok: kata.filter((k) => t.has(k)) };
    })
    .filter((m) => m.cocok.length)
    .sort((a, b) => b.cocok.length - a.cocok.length)
    .slice(0, 8);
  const potongan = kata.length ? await cariRiwayat(prisma, { query, lingkup: "pemilik", now, maks: 5 }).catch(() => []) : [];
  return {
    kata,
    memori,
    obrolan: potongan.map((p) => ({ kanal: p.kanal, umur: umurLabel(p.waktu, now), tanya: p.tanya?.slice(0, 160), jawab: p.jawab?.slice(0, 200), skor: Math.round(p.skor * 10) / 10 })),
  };
}

export async function hapusKataAction(form: FormData) {
  await requireLogin();
  await prisma.kataKategori.deleteMany({ where: { kata: String(form.get("kata")) } });
  revalidatePath("/asisten");
}

// ---------------------------------------------------------------- penyedia cadangan

const penyediaDari = (v: FormDataEntryValue | null): PenyediaCadangan | null => (CADANGAN.includes(v as PenyediaCadangan) ? (v as PenyediaCadangan) : null);

export async function simpanKunciCadanganAction(_: FormState, form: FormData): Promise<FormState> {
  await requireLogin();
  const p = penyediaDari(form.get("penyedia"));
  if (!p) return { error: "Penyedia tidak dikenal." };
  const kunci = String(form.get("kunci") ?? "").trim();
  if (!kunci) return { error: "Tempel API key-nya dulu." };
  try {
    await simpanKunciCadangan(prisma, p, kunci);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "API key tidak valid." };
  }
  const h = await tesKoneksiAI(prisma, new Date(), p);
  revalidatePath("/", "layout");
  return h.ok ? { ok: `API key ${LABEL_PENYEDIA[p]} tersimpan (terenkripsi) dan tersambung.` } : { error: `Tersimpan, tapi tes gagal (${labelKondisiCadangan(h.alasan as KondisiAI)}): ${h.pesan}` };
}

export async function hapusKunciCadanganAction(form: FormData) {
  await requireLogin();
  const p = penyediaDari(form.get("penyedia"));
  if (p) await simpanKunciCadangan(prisma, p, null);
  revalidatePath("/", "layout");
}

export async function tesCadanganAction(_: FormState, form: FormData): Promise<FormState> {
  await requireLogin();
  const p = penyediaDari(form.get("penyedia"));
  if (!p) return { error: "Penyedia tidak dikenal." };
  const h = await tesKoneksiAI(prisma, new Date(), p);
  revalidatePath("/", "layout");
  if (h.ok) return { ok: `Tersambung ke ${LABEL_PENYEDIA[p]} (${(h.durasiMs / 1000).toFixed(1)} detik).` };
  return { error: `${labelKondisiCadangan(h.alasan as KondisiAI)}: ${h.pesan}` };
}

const MODE_GRUP = ["perintah", "pertanyaan", "semua"];

/** Pengaturan AI grup WhatsApp dari website (divalidasi ketat: input datang dari browser). */
export async function simpanGrupAIAction(_: FormState, form: FormData): Promise<FormState> {
  await requireLogin();
  const jid = String(form.get("grup_ai_jid") ?? "").trim();
  const mode = String(form.get("grup_ai_mode") ?? "perintah");
  const batas = Math.round(Number(form.get("grup_ai_batas_harian")));
  const perOrang = Math.round(Number(form.get("grup_ai_per_orang_menit")));
  if (jid && !/^[\d-]{5,40}@g\.us$/.test(jid)) return { error: "ID grup tidak valid (bentuknya 1203630…@g.us). Paling mudah: ketik !aigrup aktif di grupnya." };
  if (!MODE_GRUP.includes(mode)) return { error: "Mode tidak dikenal." };
  if (!(batas >= 0 && batas <= 100000)) return { error: "Batas harian harus 0–100000 (0 = tanpa batas)." };
  if (!(perOrang >= 0 && perOrang <= 60)) return { error: "Batas per orang per menit harus 0–60 (0 = tanpa batas)." };
  const modelClaude = String(form.get("grup_ai_model_claude") ?? "otomatis");
  if (!["otomatis", "haiku", "sonnet", "opus", "bawaan"].includes(modelClaude)) return { error: "Pilihan model Claude tidak dikenal." };
  const strategi = String(form.get("grup_ai_strategi") ?? "gabung");
  if (!["gabung", "giliran"].includes(strategi)) return { error: "Cara menjawab tidak dikenal." };
  const aktif = form.get("grup_ai_aktif") === "on";
  if (aktif && !jid) return { error: "Pilih grupnya dulu (ketik !aigrup aktif di grup, atau isi ID grup)." };
  await setSetting(prisma, "grup_ai_jid", jid);
  await setSetting(prisma, "grup_ai_aktif", aktif ? "1" : "0");
  await setSetting(prisma, "grup_ai_mode", mode);
  await setSetting(prisma, "grup_ai_batas_harian", String(batas));
  await setSetting(prisma, "grup_ai_per_orang_menit", String(perOrang));
  await setSetting(prisma, "grup_ai_tanda", form.get("grup_ai_tanda") === "on" ? "1" : "0");
  await setSetting(prisma, "grup_ai_model_claude", modelClaude);
  await setSetting(prisma, "grup_ai_strategi", strategi);
  revalidatePath("/koneksi");
  return { ok: "Pengaturan AI grup disimpan." };
}

/** Lepas grup: bot berhenti menjawab di grup itu dan percakapannya dilupakan. */
export async function lepasGrupAIAction() {
  await requireLogin();
  const jid = await getSetting(prisma, "grup_ai_jid");
  await setSetting(prisma, "grup_ai_jid", "");
  await setSetting(prisma, "grup_ai_aktif", "0");
  if (jid) await prisma.aiChat.deleteMany({ where: { kanal: `grup:${jid}` } });
  revalidatePath("/koneksi");
}

/** Hapus statistik model & daftar model yang ditandai menolak (mulai belajar dari nol). */
export async function resetStatistikModelAction(_: FormState, __: FormData): Promise<FormState> {
  await requireLogin();
  await prisma.setting.deleteMany({ where: { kunci: { in: ["ai_model_statistik", "ai_openrouter_model_buruk"] } } });
  revalidatePath("/koneksi");
  return { ok: "Statistik model direset." };
}

export async function simpanCadanganAction(_: FormState, form: FormData): Promise<FormState> {
  await requireLogin();
  const onOff = (k: string) => (form.get(k) === "on" ? "1" : "0");
  const gm = String(form.get("ai_gemini_model") ?? "").trim();
  const gmr = String(form.get("ai_gemini_model_ringan") ?? "").trim();
  const om = String(form.get("ai_openrouter_model") ?? "").trim();
  const gq = String(form.get("ai_groq_model") ?? "").trim();
  const gqr = String(form.get("ai_groq_model_ringan") ?? "").trim();
  // pilihan urutan = penyedia cadangan pertama; sisanya mengikuti urutan bawaan (Gemini, OpenRouter, Groq)
  const awal = String(form.get("ai_urutan_cadangan") ?? "gemini").split(",")[0] as PenyediaCadangan;
  if (!CADANGAN.includes(awal)) return { error: "Urutan tidak dikenal." };
  const urutan = [awal, ...CADANGAN.filter((x) => x !== awal)].join(",");
  if (![gm, gmr].every((m) => /^gemini-[\w.-]{1,60}$/.test(m))) return { error: "Nama model Gemini tidak valid (contoh: gemini-3.6-flash)." };
  if (om && !modelGratis(om)) return { error: "Model OpenRouter harus model gratis (berakhiran :free)." };
  if (![gq, gqr].every(modelGroqValid)) return { error: "Nama model Groq tidak valid (contoh: llama-3.3-70b-versatile)." };
  await setSetting(prisma, "ai_claude_aktif", onOff("ai_claude_aktif"));
  await setSetting(prisma, "ai_gemini_aktif", onOff("ai_gemini_aktif"));
  await setSetting(prisma, "ai_openrouter_aktif", onOff("ai_openrouter_aktif"));
  await setSetting(prisma, "ai_groq_aktif", onOff("ai_groq_aktif"));
  await setSetting(prisma, "ai_groq_auto", onOff("ai_groq_auto"));
  await setSetting(prisma, "ai_groq_model", gq);
  await setSetting(prisma, "ai_groq_model_ringan", gqr);
  await setSetting(prisma, "ai_gemini_auto", onOff("ai_gemini_auto"));
  await setSetting(prisma, "ai_openrouter_auto", onOff("ai_openrouter_auto"));
  await setSetting(prisma, "ai_gemini_model", gm);
  await setSetting(prisma, "ai_gemini_model_ringan", gmr);
  await setSetting(prisma, "ai_openrouter_model", om);
  await setSetting(prisma, "ai_urutan_cadangan", urutan);
  revalidatePath("/", "layout");
  return { ok: "Pengaturan penyedia AI disimpan." };
}
