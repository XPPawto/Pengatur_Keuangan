"use server";

import { revalidatePath } from "next/cache";
import { requireLogin } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { rp } from "@/lib/money";
import { parseAmount } from "@/lib/parser/amount";
import { detectCategory } from "@/lib/parser/category";
import { parseStruk, type HasilStruk } from "@/lib/ocr/struk";
import { AKTOR_WEB } from "@/lib/services/activity-log";
import { jalankanSaran, simulasi, type SaranTransfer } from "@/lib/services/autopilot";
import { bayarDebt, createDebt, patungan, type Arah } from "@/lib/services/debts";
import { AppError } from "@/lib/services/errors";
import { catatKiriman, namaPengirim, ringkasBagian, type Bagian } from "@/lib/services/extra";
import { getCurrentPeriod, setPemasukan } from "@/lib/services/periods";
import { mulaiRekonsiliasi, selesaikanRekonsiliasi } from "@/lib/services/reconcile";
import { recordExpense } from "@/lib/services/transactions";
import { deleteTransfer } from "@/lib/services/transfers";
import { undoActivity } from "@/lib/services/undo";
import { logActivity } from "@/lib/services/activity-log";
import { ENVELOPE_KODE, type EnvelopeKode } from "@/lib/types";
import type { FormState } from "./actions";

function pesan(e: unknown): string {
  if (e instanceof AppError) return e.message;
  console.error(e);
  return "Ada error di server. Coba lagi.";
}
const kode = (v: FormDataEntryValue | null) => (ENVELOPE_KODE.includes(v as EnvelopeKode) ? (v as EnvelopeKode) : null);
const done = () => revalidatePath("/", "layout");

// ---------- undo ----------

export async function undoAksi(_: FormState, form: FormData): Promise<FormState> {
  await requireLogin();
  try {
    const log = await undoActivity(prisma, Number(form.get("id")), AKTOR_WEB, new Date());
    done();
    return { ok: `Dibatalkan: ${log.ringkasan}` };
  } catch (e) {
    return { error: pesan(e) };
  }
}

export async function hapusPindahan(form: FormData) {
  await requireLogin();
  await deleteTransfer(prisma, Number(form.get("id")), new Date()).catch(() => {});
  done();
}

// ---------- kiriman & koreksi ----------

export async function kirimanMasuk(_: FormState, form: FormData): Promise<FormState> {
  await requireLogin();
  const nominal = parseAmount(String(form.get("nominal") ?? ""));
  if (!nominal) return { error: "Nominal nggak kebaca. Contoh: 100k." };
  const dari = namaPengirim(String(form.get("dari") ?? ""), "Ayah");
  const mode = String(form.get("bagi") ?? "default");
  const k = kode(mode);
  const bagian: Bagian | undefined = k ? { [k]: nominal } : undefined;
  try {
    const r = await catatKiriman(prisma, { dari, nominal, bagian, actor: AKTOR_WEB, now: new Date(), tandaTerima: form.get("tandaTerima") === "on" });
    done();
    return { ok: `Kiriman ${dari} ${rp(nominal)} tercatat: ${ringkasBagian(r.bagian)}.` };
  } catch (e) {
    return { error: pesan(e) };
  }
}

export async function koreksiPemasukan(_: FormState, form: FormData): Promise<FormState> {
  await requireLogin();
  const nominal = parseAmount(String(form.get("nominal") ?? ""));
  const period = await getCurrentPeriod(prisma);
  if (!period) return { error: "Belum ada periode aktif." };
  if (!nominal) return { error: "Nominal nggak kebaca." };
  try {
    const { selisih } = await setPemasukan(prisma, period.id, nominal, new Date(), AKTOR_WEB);
    done();
    return { ok: selisih ? `Uang mingguan jadi ${rp(nominal)} (selisih ${rp(Math.abs(selisih))} lewat Darurat).` : "Tidak ada perubahan." };
  } catch (e) {
    return { error: pesan(e) };
  }
}

// ---------- rekonsiliasi ----------

export interface RekonState extends FormState {
  rec?: { id: number; saldoSistem: number; saldoAsli: number; selisih: number };
}

export async function cekSaldoAsli(_: RekonState, form: FormData): Promise<RekonState> {
  await requireLogin();
  const raw = String(form.get("saldo") ?? "").trim();
  const nominal = raw === "0" ? 0 : parseAmount(raw);
  if (nominal === null) return { error: "Nominal nggak kebaca." };
  try {
    const rec = await mulaiRekonsiliasi(prisma, nominal, AKTOR_WEB, new Date());
    done();
    if (rec.selisih === 0) return { ok: `Cocok persis: ${rp(rec.saldoAsli)}.`, rec };
    return { rec };
  } catch (e) {
    return { error: pesan(e) };
  }
}

export async function selesaikanRekon(form: FormData) {
  await requireLogin();
  const t = String(form.get("tindakan"));
  const k = kode(t);
  await selesaikanRekonsiliasi(prisma, Number(form.get("id")), k ? { catatKe: k } : t === "uang_ekstra" ? "uang_ekstra" : "abaikan", AKTOR_WEB, new Date()).catch(() => {});
  done();
}

// ---------- hutang-piutang ----------

export async function tambahHutang(_: FormState, form: FormData): Promise<FormState> {
  await requireLogin();
  const nominal = parseAmount(String(form.get("nominal") ?? ""));
  if (!nominal) return { error: "Nominal nggak kebaca." };
  try {
    const d = await createDebt(prisma, {
      orang: String(form.get("orang") ?? ""),
      arah: (form.get("arah") === "hutang" ? "hutang" : "piutang") as Arah,
      nominal,
      catatan: String(form.get("catatan") ?? ""),
      envelopeKode: kode(form.get("kode")) ?? "darurat",
      actor: AKTOR_WEB,
      now: new Date(),
    });
    done();
    return { ok: d.arah === "piutang" ? `${d.orang} pinjam ${rp(nominal)} dicatat.` : `Pinjam ke ${d.orang} ${rp(nominal)} dicatat.` };
  } catch (e) {
    return { error: pesan(e) };
  }
}

export async function bayarHutang(_: FormState, form: FormData): Promise<FormState> {
  await requireLogin();
  const raw = String(form.get("nominal") ?? "").trim();
  const nominal = raw ? parseAmount(raw) : null;
  try {
    const r = await bayarDebt(prisma, { orang: String(form.get("orang")), arah: form.get("arah") === "hutang" ? "hutang" : "piutang", nominal, actor: AKTOR_WEB, now: new Date() });
    done();
    return { ok: `${rp(r.dibayar)} dicatat${r.lunas ? ", lunas." : `, sisa ${rp(r.sisa)}.`}` };
  } catch (e) {
    return { error: pesan(e) };
  }
}

export async function patunganAction(_: FormState, form: FormData): Promise<FormState> {
  await requireLogin();
  const nominal = parseAmount(String(form.get("nominal") ?? ""));
  if (!nominal) return { error: "Nominal nggak kebaca." };
  const orang = String(form.get("orang") ?? "").split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
  try {
    const r = await patungan(prisma, { barang: String(form.get("barang") ?? "patungan"), total: nominal, orang, actor: AKTOR_WEB, now: new Date() });
    done();
    return { ok: `Bagian lo ${rp(r.bagianSendiri)}, ${r.orang.join(", ")} masing-masing ${rp(r.bagianTeman)}.` };
  } catch (e) {
    return { error: pesan(e) };
  }
}

// ---------- autopilot ----------

export async function jalankanSaranAction(form: FormData) {
  await requireLogin();
  const transfers = JSON.parse(String(form.get("transfers") ?? "[]")) as SaranTransfer[];
  await jalankanSaran(prisma, transfers, AKTOR_WEB, new Date()).catch(() => {});
  done();
}

export interface SimulasiState {
  error?: string;
  judul?: string;
  poin?: string[];
  aman?: boolean;
}

export async function simulasiAction(_: SimulasiState, form: FormData): Promise<SimulasiState> {
  await requireLogin();
  const jenis = String(form.get("jenis"));
  const nominal = parseAmount(String(form.get("nominal") ?? ""));
  if (!nominal) return { error: "Nominal nggak kebaca." };
  try {
    if (jenis === "masuk") {
      const minggu = Math.max(1, Math.min(8, Number(form.get("minggu") || 1)));
      const s = await simulasi(prisma, new Date(), { pemasukan: { nominal, jumlahMinggu: minggu } });
      return { judul: `Kalau uang mingguan ${rp(nominal)} selama ${minggu} minggu`, poin: s.poin, aman: s.aman };
    }
    const barang = String(form.get("barang") ?? "").trim() || "barang";
    const s = await simulasi(prisma, new Date(), { belanja: { nominal, barang } });
    return { judul: `Kalau beli ${barang} ${rp(nominal)}`, poin: s.poin, aman: s.aman };
  } catch (e) {
    return { error: pesan(e) };
  }
}

// ---------- struk ----------

export interface StrukState extends FormState {
  hasil?: HasilStruk;
  saranKode?: EnvelopeKode;
}

export async function bacaStrukAction(_: StrukState, form: FormData): Promise<StrukState> {
  await requireLogin();
  const file = form.get("foto");
  if (!(file instanceof File) || file.size === 0) return { error: "Pilih foto struknya dulu." };
  if (file.size > 8 * 1024 * 1024) return { error: "Foto terlalu besar (maks 8 MB)." };
  try {
    const { bacaTeksGambar } = await import("@/lib/ocr/engine");
    const teks = await bacaTeksGambar(Buffer.from(await file.arrayBuffer()));
    const hasil = parseStruk(teks);
    if (!hasil.total) return { error: "Struknya nggak kebaca jelas. Coba foto lebih terang & lurus." };
    const kat = hasil.items.map((i) => detectCategory(i.nama)).filter(Boolean) as EnvelopeKode[];
    const saranKode = (["makan", "data", "darurat"] as EnvelopeKode[]).sort((a, b) => kat.filter((k) => k === b).length - kat.filter((k) => k === a).length)[0];
    return { hasil, saranKode: kat.length ? saranKode : "makan" };
  } catch (e) {
    console.error(e);
    return { error: "Gagal membaca foto." };
  }
}

export async function simpanStrukAction(_: StrukState, form: FormData): Promise<StrukState> {
  await requireLogin();
  const mode = String(form.get("mode"));
  const now = new Date();
  try {
    const ids: number[] = [];
    if (mode === "total") {
      const nominal = parseAmount(String(form.get("total") ?? ""));
      const k = kode(form.get("kode"));
      if (!nominal || !k) return { error: "Total atau amplop belum benar." };
      const r = await recordExpense(prisma, { kode: k, nominal, catatan: String(form.get("catatan") ?? "Belanja"), sumber: "web", now, log: false });
      ids.push(r.id);
    } else {
      const items = JSON.parse(String(form.get("items") ?? "[]")) as { nama: string; harga: number; kode: EnvelopeKode }[];
      for (const it of items) {
        if (!it.harga || !kode(it.kode)) continue;
        const r = await recordExpense(prisma, { kode: it.kode, nominal: it.harga, catatan: it.nama, sumber: "web", now, log: false });
        ids.push(r.id);
      }
    }
    if (!ids.length) return { error: "Tidak ada yang dicatat." };
    await logActivity(prisma, AKTOR_WEB, "catat", `Catat dari struk (${ids.length} transaksi)`, { undo: { t: "hapus_tx", ids }, now });
    done();
    return { ok: `${ids.length} transaksi dari struk tercatat.` };
  } catch (e) {
    return { error: pesan(e) };
  }
}

// ---------- harga ----------

export async function pakaiHargaAsli(form: FormData) {
  await requireLogin();
  const harga = Number(form.get("harga"));
  if (Number.isInteger(harga) && harga > 0) {
    await prisma.shoppingItem.update({ where: { id: Number(form.get("itemId")) }, data: { hargaSatuan: harga } });
    done();
  }
}
