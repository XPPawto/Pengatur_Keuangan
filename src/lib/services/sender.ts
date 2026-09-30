import type { Db } from "../db";
import { rencanaKirim } from "../delivery";

export type SendFn = (nomor: string, text: string) => Promise<void>;

const MAKS_PERCOBAAN = 8;

/** Kirim isi antrean sesuai aturan jam tenang & jeda. Mengembalikan jumlah pesan WA yang terkirim. */
export async function kirimAntrean(db: Db, send: SendFn, now: Date): Promise<number> {
  const items = await db.outbox.findMany({ where: { status: "antri", dijadwalkan: { lte: now } }, orderBy: { id: "asc" } });
  if (items.length === 0) return 0;

  const nomorSet = [...new Set(items.map((i) => i.nomor))];
  const terakhir = new Map<string, Date>();
  for (const nomor of nomorSet) {
    const log = await db.messageLog.findFirst({ where: { nomor, arah: "keluar", proaktif: true }, orderBy: { waktu: "desc" } });
    if (log) terakhir.set(nomor, log.waktu);
  }

  const rencana = rencanaKirim(items, terakhir, now);
  for (const t of rencana.tunda) await db.outbox.update({ where: { id: t.id }, data: { dijadwalkan: t.sampai } });
  if (rencana.buang.length) {
    await db.outbox.updateMany({ where: { id: { in: rencana.buang } }, data: { status: "batal", catatan: "Basi (lewat batas tunda)" } });
  }

  let terkirim = 0;
  for (const g of rencana.kirim) {
    const isi = g.ids.map((id) => items.find((i) => i.id === id)!.isi).join("\n\n— — —\n\n");
    try {
      await send(g.nomor, isi);
      await db.outbox.updateMany({ where: { id: { in: g.ids } }, data: { status: "terkirim", terkirimPada: now } });
      await db.messageLog.create({ data: { arah: "keluar", nomor: g.nomor, isi, proaktif: g.proaktif, waktu: now } });
      terkirim++;
    } catch (e) {
      for (const id of g.ids) {
        const it = items.find((i) => i.id === id)!;
        const gagal = it.percobaan + 1 >= MAKS_PERCOBAAN;
        await db.outbox.update({
          where: { id },
          data: {
            percobaan: { increment: 1 },
            status: gagal ? "gagal" : "antri",
            catatan: String((e as Error)?.message ?? e).slice(0, 200),
            dijadwalkan: new Date(now.getTime() + 2 * 60_000),
          },
        });
      }
    }
  }
  return terkirim;
}
