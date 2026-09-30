import type { Db } from "../db";
import type { EnvelopeJenis, EnvelopeKode } from "../types";

export interface EnvelopeBalance {
  id: number;
  kode: EnvelopeKode;
  nama: string;
  jenis: EnvelopeJenis;
  terkunci: boolean;
  /** alokasi periode ini */
  alokasi: number;
  /** total pengeluaran (periode ini untuk daily/fixed, semua periode untuk sinking/goal/remainder) */
  terpakai: number;
  saldo: number;
  /** true kalau saldo dihitung lintas periode (tabungan) */
  kumulatif: boolean;
}

const KUMULATIF = new Set<EnvelopeJenis>(["sinking", "goal", "remainder"]);

export async function listEnvelopes(db: Db) {
  return db.envelope.findMany({ orderBy: { urutanTampil: "asc" } });
}

/**
 * Saldo tidak disimpan, selalu dihitung: alokasi − pengeluaran ± transfer.
 * Amplop harian/tetap per periode; amplop tabungan (paylater, kado, darurat) kumulatif lintas periode.
 */
export async function getBalances(db: Db, periodId: number | null): Promise<EnvelopeBalance[]> {
  const [envs, allocs, txs, transfers, periods] = await Promise.all([
    listEnvelopes(db),
    db.allocation.findMany(),
    db.transaction.findMany({ select: { periodId: true, envelopeId: true, nominal: true } }),
    db.transfer.findMany(),
    db.period.findMany({ select: { id: true, status: true } }),
  ]);
  const confirmed = new Set(periods.filter((p) => p.status !== "menunggu").map((p) => p.id));

  return envs.map((e) => {
    const kumulatif = KUMULATIF.has(e.jenis as EnvelopeJenis);
    const inScope = (pid: number) => (kumulatif ? confirmed.has(pid) : pid === periodId);
    const alokasiTotal = allocs.filter((a) => a.envelopeId === e.id && inScope(a.periodId)).reduce((s, a) => s + a.nominal, 0);
    const terpakai = txs.filter((t) => t.envelopeId === e.id && inScope(t.periodId)).reduce((s, t) => s + t.nominal, 0);
    const keluar = transfers.filter((t) => t.dariEnvelopeId === e.id && inScope(t.periodId)).reduce((s, t) => s + t.nominal, 0);
    const masuk = transfers.filter((t) => t.keEnvelopeId === e.id && inScope(t.periodId)).reduce((s, t) => s + t.nominal, 0);
    const alokasiPeriode = allocs.find((a) => a.envelopeId === e.id && a.periodId === periodId)?.nominal ?? 0;
    return {
      id: e.id,
      kode: e.kode as EnvelopeKode,
      nama: e.nama,
      jenis: e.jenis as EnvelopeJenis,
      terkunci: e.terkunci,
      alokasi: alokasiPeriode,
      terpakai,
      saldo: alokasiTotal - terpakai - keluar + masuk,
      kumulatif,
    };
  });
}
