import type { Db } from "../db";
import { addDays, fromWib, wibDate } from "../time";
import { listRecipients } from "./recipients";
import { getSetting } from "./settings";
import { LABEL_FITUR, statusAI, type FiturAI } from "../ai/panggil";

export type StatusWa = "terhubung" | "terputus" | "menunggu_pairing";

/** Fitur AI yang tampil di peta koneksi (urutan tetap) + saklar pengaturannya. */
const FITUR_PETA: { kode: FiturAI; saklar: "ai_aktif" | "ai_pesan_bebas" | "ai_struk" | "ai_review" | "ai_tebak_kategori" }[] = [
  { kode: "chat_web", saklar: "ai_aktif" },
  { kode: "chat_wa", saklar: "ai_pesan_bebas" },
  { kode: "struk", saklar: "ai_struk" },
  { kode: "review", saklar: "ai_review" },
  { kode: "kategori", saklar: "ai_tebak_kategori" },
];

export interface DataKoneksi {
  wa: { status: StatusWa; nomorBot: string | null; botHidup: boolean; alasan: string | null };
  ai: { kondisi: string; label: string; siap: boolean; aktif: boolean; adaToken: boolean; model: string; pakai: number; batas: number };
  nomor: { pemilik: number; keluarga: number; labelKeluarga: string[] };
  fitur: { kode: FiturAI; label: string; hariIni: number; aktif: boolean }[];
  pesanHariIni: { masuk: number; keluar: number };
  antrean: number;
}

/** Semua yang tersambung ke DompetKos dalam satu potret (peta di halaman Koneksi, dipoll tiap beberapa detik). */
export async function dataKoneksi(db: Db, now: Date): Promise<DataKoneksi> {
  const awal = fromWib(wibDate(now));
  const [c, ai, penerima, model, perFitur, masuk, keluar, antrean, saklar] = await Promise.all([
    db.waConnection.findUnique({ where: { id: 1 } }),
    statusAI(db, now),
    listRecipients(db),
    getSetting(db, "ai_model"),
    db.aiCall.groupBy({ by: ["fitur"], where: { waktu: { gte: awal } }, _count: { _all: true } }),
    db.messageLog.count({ where: { arah: "masuk", waktu: { gte: awal } } }),
    db.messageLog.count({ where: { arah: "keluar", waktu: { gte: awal } } }),
    db.outbox.count({ where: { status: "antri" } }),
    Promise.all(FITUR_PETA.map((f) => getSetting(db, f.saklar))),
  ]);
  const aktif = penerima.filter((r) => r.aktif);
  return {
    wa: {
      status: (c?.status as StatusWa) ?? "terputus",
      nomorBot: c?.nomorBot ?? null,
      botHidup: !!c?.workerPing && now.getTime() - c.workerPing.getTime() < 60_000,
      alasan: c?.alasan ?? null,
    },
    ai: { kondisi: ai.kondisi, label: ai.label, siap: ai.siap, aktif: ai.aktif, adaToken: ai.token.ada, model, pakai: ai.pemakaian.hariIni, batas: ai.pemakaian.batas },
    nomor: {
      pemilik: aktif.filter((r) => r.peran === "pemilik").length,
      keluarga: aktif.filter((r) => r.peran === "keluarga").length,
      labelKeluarga: aktif.filter((r) => r.peran === "keluarga").map((r) => r.label),
    },
    fitur: FITUR_PETA.map((f, i) => ({
      kode: f.kode,
      label: LABEL_FITUR[f.kode],
      hariIni: perFitur.find((x) => x.fitur === f.kode)?._count._all ?? 0,
      aktif: ai.aktif && saklar[i] === "1",
    })),
    pesanHariIni: { masuk, keluar },
    antrean,
  };
}

/** Statistik pemakaian Claude untuk halaman Koneksi. */
export async function ringkasanPemakaian(db: Db, now: Date, hari = 14) {
  const today = wibDate(now);
  const mulai = addDays(today, -(hari - 1));
  const calls = await db.aiCall.findMany({ where: { waktu: { gte: fromWib(mulai) } }, orderBy: { id: "desc" } });
  const tanggal = Array.from({ length: hari }, (_, i) => addDays(mulai, i));
  const fiturList = Object.keys(LABEL_FITUR) as FiturAI[];

  const perHari = tanggal.map((t) => {
    const row: Record<string, number> = {};
    for (const f of fiturList) row[f] = 0;
    for (const c of calls) if (wibDate(c.waktu) === t) row[c.fitur] = (row[c.fitur] ?? 0) + 1;
    return row;
  });

  const tujuh = calls.filter((c) => wibDate(c.waktu) >= addDays(today, -6));
  const perFitur = fiturList
    .map((f) => {
      const rows = tujuh.filter((c) => c.fitur === f);
      const ok = rows.filter((c) => c.status === "ok");
      return {
        kode: f,
        label: LABEL_FITUR[f],
        panggilan: rows.length,
        berhasil: ok.length,
        rataDetik: ok.length ? ok.reduce((s, c) => s + c.durasiMs, 0) / ok.length / 1000 : null,
        tokenMasuk: rows.reduce((s, c) => s + c.tokenMasuk, 0),
        tokenKeluar: rows.reduce((s, c) => s + c.tokenKeluar, 0),
      };
    })
    .filter((f) => f.panggilan > 0);

  const ini = calls.filter((c) => wibDate(c.waktu) === today);
  const okTujuh = tujuh.filter((c) => c.status === "ok");
  return {
    tanggal,
    perHari,
    fiturList,
    hariIni: {
      panggilan: ini.length,
      gagal: ini.filter((c) => c.status !== "ok").length,
      tokenMasuk: ini.reduce((s, c) => s + c.tokenMasuk, 0),
      tokenKeluar: ini.reduce((s, c) => s + c.tokenKeluar, 0),
    },
    tujuhHari: {
      panggilan: tujuh.length,
      tingkatBerhasil: tujuh.length ? okTujuh.length / tujuh.length : null,
      rataDetik: okTujuh.length ? okTujuh.reduce((s, c) => s + c.durasiMs, 0) / okTujuh.length / 1000 : null,
      tokenTotal: tujuh.reduce((s, c) => s + c.tokenMasuk + c.tokenKeluar, 0),
    },
    perFitur,
    terakhir: calls.slice(0, 15),
  };
}
