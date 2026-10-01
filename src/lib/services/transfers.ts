import type { Db } from "../db";
import { KATA_BUKA_KUNCI, type EnvelopeKode, type Sumber } from "../types";
import { AppError } from "./errors";
import { getBalances } from "./envelopes";
import { getCurrentPeriod } from "./periods";
import { logActivity, type Actor } from "./activity-log";
import { rp } from "../money";

export interface TransferInput {
  dari: EnvelopeKode;
  ke: EnvelopeKode;
  nominal: number;
  alasan: string;
  now: Date;
  sumber?: Sumber;
  konfirmasiBukaKunci?: string;
  actor?: Actor;
}

/** Pindah uang antar amplop. Selalu tercatat beserta alasannya. Ambil dari amplop terkunci butuh kata konfirmasi. */
export async function transferBetween(db: Db, t: TransferInput) {
  if (t.dari === t.ke) throw new AppError("invalid", "Amplop asal dan tujuan nggak boleh sama.");
  if (!Number.isInteger(t.nominal) || t.nominal <= 0) throw new AppError("invalid", "Nominal harus lebih dari 0.");
  if (!t.alasan.trim()) throw new AppError("invalid", "Alasan pindah wajib diisi.");
  const period = await getCurrentPeriod(db);
  if (!period) throw new AppError("no_period", "Belum ada periode aktif.");
  const [dari, ke] = await Promise.all([
    db.envelope.findUnique({ where: { kode: t.dari } }),
    db.envelope.findUnique({ where: { kode: t.ke } }),
  ]);
  if (!dari || !ke) throw new AppError("not_found", "Amplop tidak ditemukan.");
  if (dari.terkunci && t.konfirmasiBukaKunci?.trim().toUpperCase() !== KATA_BUKA_KUNCI) {
    throw new AppError("locked", `${dari.nama} terkunci. Ketik "${KATA_BUKA_KUNCI}" buat lanjut.`);
  }
  const tr = await db.transfer.create({
    data: { periodId: period.id, dariEnvelopeId: dari.id, keEnvelopeId: ke.id, nominal: t.nominal, alasan: t.alasan.trim(), dibuatPada: t.now },
  });
  await logActivity(db, t.actor ?? { oleh: t.sumber ?? "web", sumber: t.sumber ?? "web" }, "pindah", `Pindah ${rp(t.nominal)} ${dari.nama} → ${ke.nama} (${t.alasan.trim()})`, {
    undo: { t: "hapus_transfer", ids: [tr.id] },
    now: t.now,
  });
  const balances = await getBalances(db, period.id);
  return {
    transfer: tr,
    saldoDari: balances.find((b) => b.kode === t.dari)!.saldo,
    saldoKe: balances.find((b) => b.kode === t.ke)!.saldo,
    namaDari: dari.nama,
    namaKe: ke.nama,
  };
}

/** Hapus pindahan (dari Riwayat). Isinya tersimpan di riwayat aktivitas sehingga bisa dipulihkan. */
export async function deleteTransfer(db: Db, id: number, now: Date, actor: Actor = { oleh: "web", sumber: "web" }) {
  const tr = await db.transfer.findUnique({ where: { id }, include: { dari: true, ke: true } });
  if (!tr) throw new AppError("not_found", "Pindahan tidak ditemukan.");
  await db.transfer.delete({ where: { id } });
  await logActivity(db, actor, "hapus_pindah", `Hapus pindahan ${rp(tr.nominal)} ${tr.dari.nama} → ${tr.ke.nama}`, {
    undo: {
      t: "pulihkan_transfer",
      rows: [{ id: tr.id, periodId: tr.periodId, dariEnvelopeId: tr.dariEnvelopeId, keEnvelopeId: tr.keEnvelopeId, nominal: tr.nominal, alasan: tr.alasan, dibuatPada: tr.dibuatPada.toISOString() }],
    },
    now,
  });
}
