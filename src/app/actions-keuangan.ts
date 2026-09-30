"use server";

import { revalidatePath } from "next/cache";
import { requireLogin } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { rp } from "@/lib/money";
import { parseAmount } from "@/lib/parser/amount";
import { AppError } from "@/lib/services/errors";
import { createBill, deleteBill, markBillUnpaid, payBill, updateBill } from "@/lib/services/bills";
import { updateEnvelopeSettings } from "@/lib/services/envelopes";
import { updateGoal } from "@/lib/services/goals";
import { getCurrentPeriod, setAllocation, setPlan } from "@/lib/services/periods";
import { transferBetween } from "@/lib/services/transfers";
import { ENVELOPE_KODE, type EnvelopeKode } from "@/lib/types";
import type { FormState } from "./actions";

function pesan(e: unknown): string {
  if (e instanceof AppError) return e.message;
  console.error(e);
  return "Ada error di server. Coba lagi.";
}
const kode = (v: FormDataEntryValue | null) => (ENVELOPE_KODE.includes(v as EnvelopeKode) ? (v as EnvelopeKode) : null);
const done = () => revalidatePath("/", "layout");

// ---------- amplop ----------

export async function pindahAmplop(_: FormState, form: FormData): Promise<FormState> {
  await requireLogin();
  const dari = kode(form.get("dari"));
  const ke = kode(form.get("ke"));
  const nominal = parseAmount(String(form.get("nominal") ?? ""));
  if (!dari || !ke) return { error: "Pilih amplop asal dan tujuan." };
  if (!nominal) return { error: "Nominal nggak kebaca." };
  try {
    const r = await transferBetween(prisma, {
      dari,
      ke,
      nominal,
      alasan: String(form.get("alasan") ?? ""),
      now: new Date(),
      sumber: "web",
      konfirmasiBukaKunci: String(form.get("konfirmasi") ?? ""),
    });
    done();
    return { ok: `Pindah ${rp(nominal)}: ${r.namaDari} → ${r.namaKe}.` };
  } catch (e) {
    return { error: pesan(e) };
  }
}

export async function simpanAlokasi(_: FormState, form: FormData): Promise<FormState> {
  await requireLogin();
  const period = await getCurrentPeriod(prisma);
  if (!period) return { error: "Belum ada periode aktif." };
  try {
    let hasil = { totalAlokasi: 0, pemasukan: 0 };
    for (const k of ENVELOPE_KODE) {
      const v = form.get(`alokasi_${k}`);
      if (v === null) continue;
      const n = String(v).trim() === "0" ? 0 : parseAmount(String(v));
      if (n === null) return { error: `Nominal ${k} nggak kebaca.` };
      hasil = await setAllocation(prisma, period.id, k, n);
    }
    done();
    const selisih = hasil.pemasukan - hasil.totalAlokasi;
    return selisih === 0
      ? { ok: "Alokasi tersimpan dan pas dengan pemasukan." }
      : { ok: `Tersimpan. Catatan: total alokasi ${selisih > 0 ? "kurang" : "lebih"} ${rp(Math.abs(selisih))} dari pemasukan ${rp(hasil.pemasukan)}.` };
  } catch (e) {
    return { error: pesan(e) };
  }
}

export async function simpanPengaturanAmplop(_: FormState, form: FormData): Promise<FormState> {
  await requireLogin();
  const k = kode(form.get("kode"));
  if (!k) return { error: "Amplop tidak valid." };
  const def = parseAmount(String(form.get("defaultNominal") ?? ""));
  const urut = String(form.get("urutanPotong") ?? "");
  try {
    await updateEnvelopeSettings(
      prisma,
      k,
      {
        defaultNominal: String(form.get("defaultNominal")).trim() === "0" ? 0 : (def ?? undefined),
        urutanPotong: urut === "" ? null : Number(urut),
        terkunci: form.get("terkunci") === "on",
      },
      String(form.get("konfirmasi") ?? ""),
    );
    done();
    return { ok: "Tersimpan." };
  } catch (e) {
    return { error: pesan(e) };
  }
}

export async function simpanRencana(_: FormState, form: FormData): Promise<FormState> {
  await requireLogin();
  const tanggal = String(form.get("tanggalMulai") ?? "");
  const alloc: Partial<Record<EnvelopeKode, number>> = {};
  for (const k of ENVELOPE_KODE) {
    const raw = String(form.get(k) ?? "").trim();
    const n = raw === "0" ? 0 : parseAmount(raw);
    if (n === null) return { error: `Nominal ${k} nggak kebaca.` };
    alloc[k] = n;
  }
  try {
    await setPlan(prisma, tanggal, alloc);
    done();
    return { ok: "Rencana tersimpan." };
  } catch (e) {
    return { error: pesan(e) };
  }
}

// ---------- tagihan ----------

function billInput(form: FormData) {
  return {
    nama: String(form.get("nama") ?? ""),
    nominal: parseAmount(String(form.get("nominal") ?? "")) ?? 0,
    jatuhTempo: String(form.get("jatuhTempo") ?? ""),
    tanggalPasti: form.get("tanggalPasti") === "on",
    envelopeKode: kode(form.get("envelopeKode")),
    catatan: String(form.get("catatan") ?? ""),
  };
}

export async function simpanTagihan(_: FormState, form: FormData): Promise<FormState> {
  await requireLogin();
  const id = Number(form.get("id") || 0);
  try {
    if (id) await updateBill(prisma, id, billInput(form));
    else await createBill(prisma, billInput(form));
    done();
    return { ok: id ? "Tagihan diperbarui." : "Tagihan ditambahkan." };
  } catch (e) {
    return { error: pesan(e) };
  }
}

export async function bayarTagihan(_: FormState, form: FormData): Promise<FormState> {
  await requireLogin();
  const nominal = parseAmount(String(form.get("nominal") ?? ""));
  try {
    const r = await payBill(prisma, Number(form.get("id")), { nominal: nominal ?? undefined, now: new Date(), sumber: "web" });
    done();
    return { ok: `${r.bill.nama} lunas (${rp(r.dibayar)}).` };
  } catch (e) {
    return { error: pesan(e) };
  }
}

export async function batalLunas(form: FormData) {
  await requireLogin();
  await markBillUnpaid(prisma, Number(form.get("id")));
  done();
}

export async function hapusTagihan(form: FormData) {
  await requireLogin();
  await deleteBill(prisma, Number(form.get("id"))).catch(() => {});
  done();
}

// ---------- target ----------

export async function simpanTarget(_: FormState, form: FormData): Promise<FormState> {
  await requireLogin();
  try {
    await updateGoal(prisma, Number(form.get("id")), {
      nama: String(form.get("nama") ?? ""),
      targetMin: parseAmount(String(form.get("targetMin") ?? "")) ?? 0,
      targetIdeal: parseAmount(String(form.get("targetIdeal") ?? "")) ?? 0,
      tenggat: String(form.get("tenggat") ?? ""),
    });
    done();
    return { ok: "Target tersimpan." };
  } catch (e) {
    return { error: pesan(e) };
  }
}
