import type { Db } from "../db";

export interface EnqueueInput {
  nomor: string;
  jenis: string;
  isi: string;
  /** kunci unik; kalau sudah ada, pesan tidak dimasukkan lagi */
  kunci?: string;
  dijadwalkan?: Date;
}

/** Masukkan pesan ke antrean. Mengembalikan false kalau kunci sudah pernah dipakai. */
export async function enqueue(db: Db, m: EnqueueInput, now = new Date()): Promise<boolean> {
  if (m.kunci) {
    const ada = await db.outbox.findUnique({ where: { kunci: m.kunci } });
    if (ada) return false;
  }
  try {
    await db.outbox.create({
      data: { nomor: m.nomor, jenis: m.jenis, isi: m.isi, kunci: m.kunci, dijadwalkan: m.dijadwalkan ?? now },
    });
    return true;
  } catch {
    return false; // balapan kunci unik
  }
}

export async function recentOutbox(db: Db, take = 30) {
  return db.outbox.findMany({ orderBy: { id: "desc" }, take });
}
