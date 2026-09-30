"use server";

import { revalidatePath } from "next/cache";
import { requireLogin } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { parseAmount } from "@/lib/parser/amount";
import { AppError } from "@/lib/services/errors";
import { backupDatabase } from "@/lib/services/backup";
import { createHold, decideHold } from "@/lib/services/holds";
import { enqueue } from "@/lib/services/outbox";
import { deleteRecipient, saveRecipient, type Peran } from "@/lib/services/recipients";
import { updateReminder, type JenisPengingat } from "@/lib/services/scheduler";
import { setSetting } from "@/lib/services/settings";
import {
  createShoppingItem,
  deleteShoppingItem,
  toggleShoppingCheck,
  updateLauk,
  updateMenuItem,
  updateShoppingItem,
} from "@/lib/services/shopping";
import { normalizePhone } from "@/lib/whitelist";
import type { FormState } from "./actions";

function pesan(e: unknown): string {
  if (e instanceof AppError || e instanceof Error) return e.message;
  return "Ada error di server. Coba lagi.";
}
const done = () => revalidatePath("/", "layout");

// ---------- belanja ----------

export async function centangBelanja(form: FormData) {
  await requireLogin();
  await toggleShoppingCheck(prisma, String(form.get("minggu")), Number(form.get("itemId")), form.get("dibeli") === "1");
  done();
}

export async function simpanItemBelanja(_: FormState, form: FormData): Promise<FormState> {
  await requireLogin();
  const id = Number(form.get("id") || 0);
  const harga = parseAmount(String(form.get("hargaSatuan") ?? ""));
  const jumlah = Number(String(form.get("jumlah") ?? "").replace(",", "."));
  const data = {
    nama: String(form.get("nama") ?? ""),
    jumlah,
    satuan: String(form.get("satuan") ?? ""),
    hargaSatuan: harga ?? -1,
    kataKunci: String(form.get("kataKunci") ?? "").split(",").filter(Boolean),
  };
  if (harga === null) return { error: "Harga nggak kebaca." };
  if (!Number.isFinite(jumlah)) return { error: "Jumlah nggak valid." };
  try {
    if (id) await updateShoppingItem(prisma, id, { ...data, aktif: form.get("aktif") === "on" });
    else await createShoppingItem(prisma, data);
    done();
    return { ok: "Tersimpan." };
  } catch (e) {
    return { error: pesan(e) };
  }
}

export async function hapusItemBelanja(form: FormData) {
  await requireLogin();
  await deleteShoppingItem(prisma, Number(form.get("id"))).catch(() => {});
  done();
}

export async function simpanMenu(_: FormState, form: FormData): Promise<FormState> {
  await requireLogin();
  for (const [k, v] of form.entries()) {
    const m = /^menu_(\d+)$/.exec(k);
    if (m && String(v).trim()) await updateMenuItem(prisma, Number(m[1]), String(v));
  }
  for (let i = 1; i <= 4; i++) {
    const nama = form.get(`lauk_${i}_nama`);
    if (nama === null) continue;
    await updateLauk(prisma, i, {
      nama: String(nama),
      jumlah: String(form.get(`lauk_${i}_jumlah`) ?? ""),
      estimasi: parseAmount(String(form.get(`lauk_${i}_estimasi`) ?? "")) ?? 0,
    });
  }
  done();
  return { ok: "Menu & lauk tersimpan." };
}

// ---------- tahan belanja ----------

export async function tahanBelanja(_: FormState, form: FormData): Promise<FormState> {
  await requireLogin();
  const nominal = parseAmount(String(form.get("nominal") ?? ""));
  if (!nominal) return { error: "Nominal nggak kebaca." };
  try {
    await createHold(prisma, { barang: String(form.get("barang") ?? ""), nominal, now: new Date() });
    done();
    return { ok: "Ditahan 24 jam. Bot bakal nanya lagi besok." };
  } catch (e) {
    return { error: pesan(e) };
  }
}

export async function putuskanTahan(form: FormData) {
  await requireLogin();
  const k = form.get("keputusan") === "beli" ? "beli" : "batal";
  await decideHold(prisma, Number(form.get("id")), k, new Date(), "web").catch(() => {});
  done();
}

// ---------- pengaturan ----------

export async function simpanPenerima(_: FormState, form: FormData): Promise<FormState> {
  await requireLogin();
  try {
    await saveRecipient(prisma, {
      nomor: String(form.get("nomor") ?? ""),
      label: String(form.get("label") ?? ""),
      peran: (form.get("peran") === "keluarga" ? "keluarga" : "pemilik") as Peran,
      terimaPengingat: form.get("terimaPengingat") === "on",
      terimaLaporan: form.get("terimaLaporan") === "on",
      terimaKonfirmasiUang: form.get("terimaKonfirmasiUang") === "on",
      aktif: form.get("aktif") !== null ? form.get("aktif") === "on" : true,
    });
    done();
    return { ok: "Nomor tersimpan." };
  } catch (e) {
    return { error: pesan(e) };
  }
}

export async function hapusPenerima(form: FormData) {
  await requireLogin();
  await deleteRecipient(prisma, String(form.get("nomor"))).catch(() => {});
  done();
}

export async function kirimPesanTes(form: FormData) {
  await requireLogin();
  await enqueue(prisma, {
    nomor: normalizePhone(String(form.get("nomor"))),
    jenis: "tes",
    isi: "Pesan tes dari DompetKos. Kalau ini sampai, pengiriman bot aman.",
  });
  done();
}

export async function simpanPengingat(_: FormState, form: FormData): Promise<FormState> {
  await requireLogin();
  try {
    for (const [k, v] of form.entries()) {
      const m = /^jam_(.+)$/.exec(k);
      if (!m) continue;
      await updateReminder(prisma, m[1] as JenisPengingat, String(v), form.get(`aktif_${m[1]}`) === "on");
    }
    done();
    return { ok: "Jadwal pengingat tersimpan." };
  } catch (e) {
    return { error: pesan(e) };
  }
}

export async function simpanUmum(_: FormState, form: FormData): Promise<FormState> {
  await requireLogin();
  const nama = String(form.get("nama_pengguna") ?? "").trim();
  const batas = String(form.get("batas_tahan") ?? "").trim();
  const batasN = batas === "0" ? 0 : parseAmount(batas);
  if (!nama) return { error: "Nama wajib diisi." };
  if (batasN === null) return { error: "Batas tahan belanja nggak kebaca." };
  await setSetting(prisma, "nama_pengguna", nama);
  await setSetting(prisma, "batas_tahan", String(batasN));
  await setSetting(prisma, "otp_login", form.get("otp_login") === "on" ? "1" : "0");
  done();
  return { ok: "Pengaturan tersimpan." };
}

export async function backupSekarang(_: FormState): Promise<FormState> {
  await requireLogin();
  try {
    const file = await backupDatabase(prisma);
    done();
    return { ok: `Backup dibuat: ${file.split("/").pop()}` };
  } catch (e) {
    return { error: pesan(e) };
  }
}
