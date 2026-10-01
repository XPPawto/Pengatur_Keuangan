import type { Db } from "../db";

/** Siapa yang melakukan aksi: nomor WA pemilik, "web", atau "sistem". */
export interface Actor {
  oleh: string;
  sumber: "wa" | "web" | "sistem";
}

export const AKTOR_WEB: Actor = { oleh: "web", sumber: "web" };
export const AKTOR_SISTEM: Actor = { oleh: "sistem", sumber: "sistem" };

export interface TxSnap {
  id: number;
  periodId: number;
  envelopeId: number;
  nominal: number;
  jenis: string;
  catatan: string;
  sumber: string;
  pesanAsli: string | null;
  tanggal: string;
  dibuatPada: string;
  billId: number | null;
  debtId: number | null;
}

export interface TransferSnap {
  id: number;
  periodId: number;
  dariEnvelopeId: number;
  keEnvelopeId: number;
  nominal: number;
  alasan: string;
  dibuatPada: string;
}

/** Cara membatalkan sebuah aksi. Disimpan sebagai JSON di ActivityLog.undo. */
export type Undo =
  | { t: "hapus_tx"; ids: number[] }
  | { t: "pulihkan_tx"; rows: TxSnap[]; lunasKembali?: number[] }
  | { t: "kembalikan_tx"; id: number; sebelum: { nominal: number; catatan: string; envelopeId: number } }
  | { t: "hapus_transfer"; ids: number[] }
  | { t: "pulihkan_transfer"; rows: TransferSnap[] }
  | { t: "batal_bayar"; billId: number; txId: number | null; nominalSebelum: number }
  | { t: "batal_periode"; periodId: number; transferIds: number[]; periodeLamaIds: number[] }
  | { t: "kurangi_alokasi"; periodId: number; bagian: Record<string, number>; extraIncomeId?: number }
  | { t: "tanpa_jajan_off"; tanggal: string; sebelum: boolean }
  | { t: "hold_menunggu"; holdId: number; txId: number | null }
  | { t: "batal_debt"; debtId: number; txIds: number[]; periodId: number | null; bagian: Record<string, number> }
  | {
      t: "batal_debt_bayar";
      paymentId: number;
      debtId: number;
      txIds: number[];
      periodId: number | null;
      bagian: Record<string, number>;
      statusSebelum: string;
    }
  | { t: "pemasukan"; periodId: number; pemasukanSebelum: number; alokasiSebelum: Record<string, number> }
  | { t: "batal_patungan"; txIds: number[]; debtIds: number[] }
  | { t: "jalankan_saran"; transferIds: number[] };

export function snapTx(t: {
  id: number;
  periodId: number;
  envelopeId: number;
  nominal: number;
  jenis: string;
  catatan: string;
  sumber: string;
  pesanAsli: string | null;
  tanggal: string;
  dibuatPada: Date;
  billId: number | null;
  debtId: number | null;
}): TxSnap {
  return {
    id: t.id,
    periodId: t.periodId,
    envelopeId: t.envelopeId,
    nominal: t.nominal,
    jenis: t.jenis,
    catatan: t.catatan,
    sumber: t.sumber,
    pesanAsli: t.pesanAsli,
    tanggal: t.tanggal,
    dibuatPada: t.dibuatPada.toISOString(),
    billId: t.billId,
    debtId: t.debtId,
  };
}

export async function logActivity(
  db: Db,
  actor: Actor,
  aksi: string,
  ringkasan: string,
  opts: { undo?: Undo | null; data?: unknown; now?: Date } = {},
) {
  return db.activityLog.create({
    data: {
      waktu: opts.now ?? new Date(),
      oleh: actor.oleh,
      sumber: actor.sumber,
      aksi,
      ringkasan,
      data: opts.data === undefined ? null : JSON.stringify(opts.data),
      undo: opts.undo ? JSON.stringify(opts.undo) : null,
    },
  });
}
