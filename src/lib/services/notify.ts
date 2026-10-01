import type { Db } from "../db";
import { confirmPeriod, getPeriodAllocations } from "./periods";
import type { Actor } from "./activity-log";
import { enqueue } from "./outbox";
import { recipientsFor } from "./recipients";
import { konfirmasiUangText } from "./reports";
import { getSetting } from "./settings";
import { wibDate } from "../time";

/** Konfirmasi periode + kirim tanda terima ke keluarga yang mengaktifkannya. Dipakai bot & website. */
export async function confirmPeriodAndNotify(db: Db, periodId: number, now: Date, actor?: Actor) {
  const hasil = await confirmPeriod(db, periodId, now, actor);
  const [keluarga, nama, alloc] = await Promise.all([
    recipientsFor(db, "keluarga", "konfirmasiUang"),
    getSetting(db, "nama_pengguna"),
    getPeriodAllocations(db, periodId),
  ]);
  const isi = konfirmasiUangText(nama, hasil.period.pemasukan, wibDate(now), alloc);
  for (const nomor of keluarga) {
    await enqueue(db, { nomor, jenis: "konfirmasi_uang", isi, kunci: `konfirmasi_uang:${periodId}:${nomor}` }, now);
  }
  return hasil;
}
