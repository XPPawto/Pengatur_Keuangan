import type { Db } from "../db";
import { addDays, fromWib, wibDate } from "../time";
import { listRecipients } from "./recipients";
import { getSetting, getSettingNumber } from "./settings";
import { jawabanGrupHariIni, penyediaTersedia, urutanGiliran } from "../ai/grup";
import type { Penyedia } from "../ai/panggil";
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
  ai: {
    kondisi: string;
    label: string;
    /** ada penyedia (Claude atau cadangan) yang bisa dipakai */
    siap: boolean;
    claudeSiap: boolean;
    aktif: boolean;
    adaToken: boolean;
    model: string;
    pakai: number;
    batas: number;
    /** persen terpakai langganan: sesi 5 jam & mingguan (null = belum ada data) */
    sesi5Jam: number | null;
    mingguan: number | null;
    /** penyedia cadangan (Gemini, OpenRouter) */
    cadangan: { penyedia: string; label: string; aktif: boolean; ada: boolean; siap: boolean; labelKondisi: string; model: string }[];
  };
  nomor: { pemilik: number; keluarga: number; labelKeluarga: string[] };
  /** `per` = jumlah panggilan hari ini per penyedia (claude/gemini/openrouter) */
  fitur: { kode: FiturAI; label: string; hariIni: number; per: Record<string, number>; aktif: boolean }[];
  pesanHariIni: { masuk: number; keluar: number };
  antrean: number;
  /** AI grup WhatsApp: asisten umum untuk satu grup, penyedia bergiliran (round robin) */
  grup: {
    /** grup sudah dipilih */
    dipilih: boolean;
    aktif: boolean;
    /** jawaban yang berhasil hari ini */
    hariIni: number;
    batas: number;
    /** jawaban berhasil hari ini per penyedia */
    per: Record<string, number>;
    /** penyedia yang tersambung = ikut bergiliran, urut: Claude, Gemini, OpenRouter */
    roda: Penyedia[];
    /** gabung = semua penyedia menjawab bersama lalu digabung; giliran = bergantian (round robin) */
    strategi: "gabung" | "giliran";
    /** penyedia yang mendapat giliran berikutnya (hanya mode giliran) */
    berikut: Penyedia | null;
  };
}

/** Semua yang tersambung ke DompetKos dalam satu potret (peta di halaman Koneksi, dipoll tiap beberapa detik). */
export async function dataKoneksi(db: Db, now: Date): Promise<DataKoneksi> {
  const awal = fromWib(wibDate(now));
  const [c, ai, penerima, model, perFitur, masuk, keluar, antrean, saklar, grupOk, roda, putaran] = await Promise.all([
    db.waConnection.findUnique({ where: { id: 1 } }),
    statusAI(db, now),
    listRecipients(db),
    getSetting(db, "ai_model"),
    db.aiCall.groupBy({ by: ["fitur", "penyedia"], where: { waktu: { gte: awal } }, _count: { _all: true } }),
    db.messageLog.count({ where: { arah: "masuk", waktu: { gte: awal } } }),
    db.messageLog.count({ where: { arah: "keluar", waktu: { gte: awal } } }),
    db.outbox.count({ where: { status: "antri" } }),
    Promise.all(FITUR_PETA.map((f) => getSetting(db, f.saklar))),
    db.aiCall.groupBy({ by: ["penyedia"], where: { fitur: "chat_grup", status: "ok", waktu: { gte: awal } }, _count: { _all: true } }),
    penyediaTersedia(db),
    getSettingNumber(db, "grup_ai_putaran"),
  ]);
  const [grupJid, grupAktif, grupBatas, grupStrategi, grupHariIni] = await Promise.all([getSetting(db, "grup_ai_jid"), getSetting(db, "grup_ai_aktif"), getSettingNumber(db, "grup_ai_batas_harian"), getSetting(db, "grup_ai_strategi"), jawabanGrupHariIni(db, now)]);
  const aktif = penerima.filter((r) => r.aktif);
  return {
    wa: {
      status: (c?.status as StatusWa) ?? "terputus",
      nomorBot: c?.nomorBot ?? null,
      botHidup: !!c?.workerPing && now.getTime() - c.workerPing.getTime() < 60_000,
      alasan: c?.alasan ?? null,
    },
    ai: {
      kondisi: ai.kondisi,
      label: ai.label,
      siap: ai.siap,
      claudeSiap: ai.claudeSiap,
      aktif: ai.aktif,
      adaToken: ai.token.ada,
      model,
      pakai: ai.pemakaian.hariIni,
      batas: ai.pemakaian.batas,
      sesi5Jam: ai.langganan.find((j) => j.kode === "five_hour")?.persen ?? null,
      mingguan: ai.langganan.find((j) => j.kode === "seven_day")?.persen ?? null,
      cadangan: ai.cadangan.map((c) => ({ penyedia: c.penyedia, label: c.label, aktif: c.aktif, ada: c.ada, siap: c.siap, labelKondisi: c.labelKondisi, model: c.model })),
    },
    nomor: {
      pemilik: aktif.filter((r) => r.peran === "pemilik").length,
      keluarga: aktif.filter((r) => r.peran === "keluarga").length,
      labelKeluarga: aktif.filter((r) => r.peran === "keluarga").map((r) => r.label),
    },
    fitur: FITUR_PETA.map((f, i) => ({
      kode: f.kode,
      label: LABEL_FITUR[f.kode],
      hariIni: perFitur.filter((x) => x.fitur === f.kode).reduce((n, x) => n + x._count._all, 0),
      per: Object.fromEntries(perFitur.filter((x) => x.fitur === f.kode).map((x) => [x.penyedia, x._count._all])),
      aktif: ai.aktif && saklar[i] === "1",
    })),
    pesanHariIni: { masuk, keluar },
    antrean,
    grup: {
      dipilih: !!grupJid,
      aktif: !!grupJid && grupAktif === "1",
      hariIni: grupHariIni, // jawaban (satu per pertanyaan, walau dijawab beberapa penyedia sekaligus)
      batas: grupBatas, // 0 = tanpa batas
      per: Object.fromEntries(grupOk.map((x) => [x.penyedia, x._count._all])),
      roda,
      strategi: grupStrategi === "giliran" ? "giliran" : "gabung",
      berikut: grupStrategi === "giliran" ? (urutanGiliran(roda, putaran)[0] ?? null) : null,
    },
  };
}

/** Statistik pemakaian Claude untuk halaman Koneksi. */
export async function ringkasanPemakaian(db: Db, now: Date, hari = 14) {
  const today = wibDate(now);
  const mulai = addDays(today, -(hari - 1));
  const semua = await db.aiCall.findMany({ where: { waktu: { gte: fromWib(mulai) } }, orderBy: { id: "desc" } });
  // panggilan yang masih berjalan belum punya hasil: tidak ikut statistik, tapi tampil di log
  const calls = semua.filter((c) => c.status !== "berjalan");
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
    terakhir: semua.slice(0, 15).map((c) => ({ ...c, status: c.status === "berjalan" && now.getTime() - c.waktu.getTime() > BERJALAN_MAKS_MS ? "terputus" : c.status })),
  };
}

// ---------------------------------------------------------------- denyut (aktivitas langsung untuk animasi peta)

/** Panggilan "berjalan" lebih lama dari ini dianggap terputus (proses mati di tengah jalan). */
export const BERJALAN_MAKS_MS = 5 * 60_000;

export interface Denyut {
  kursor: { pesan: number; ai: number };
  /** pesan WhatsApp baru (tanpa isi) */
  pesan: { id: number; arah: "masuk" | "keluar"; peran: "pemilik" | "keluarga"; proaktif: boolean; waktu: string }[];
  /** panggilan AI baru (status bisa masih "berjalan"); penyedia: claude | gemini | openrouter */
  ai: { id: number; fitur: FiturAI; penyedia: string; status: string; waktu: string }[];
  /** status terbaru panggilan yang ditanyakan klien (yang tadinya masih berjalan) */
  cek: { id: number; status: string }[];
}

/**
 * Aktivitas sejak kursor terakhir klien: pesan WA masuk/keluar dan panggilan Claude. Isi pesan tidak pernah
 * dikirim, hanya arah & peran nomornya. Tanpa kursor = hanya mengembalikan kursor (tidak memutar ulang riwayat).
 */
export async function denyutKoneksi(db: Db, now: Date, k: { pesan?: number; ai?: number; cek?: number[] }): Promise<Denyut> {
  const [pesanAkhir, aiAkhir] = await Promise.all([
    db.messageLog.findFirst({ orderBy: { id: "desc" }, select: { id: true } }),
    db.aiCall.findFirst({ orderBy: { id: "desc" }, select: { id: true } }),
  ]);
  const kursor = { pesan: pesanAkhir?.id ?? 0, ai: aiAkhir?.id ?? 0 };
  const out: Denyut = { kursor, pesan: [], ai: [], cek: [] };

  if (k.pesan !== undefined && k.pesan < kursor.pesan) {
    const peran = new Map((await listRecipients(db)).filter((r) => r.aktif).map((r) => [r.nomor, r.peran]));
    const rows = await db.messageLog.findMany({ where: { id: { gt: k.pesan } }, orderBy: { id: "asc" }, take: 30 });
    for (const m of rows) {
      const p = peran.get(m.nomor);
      if (!p || (m.arah !== "masuk" && m.arah !== "keluar")) continue;
      out.pesan.push({ id: m.id, arah: m.arah, peran: p, proaktif: m.proaktif, waktu: m.waktu.toISOString() });
    }
  }
  if (k.ai === undefined) {
    // halaman baru dibuka: tampilkan panggilan yang sedang berjalan
    const rows = await db.aiCall.findMany({ where: { status: "berjalan", waktu: { gte: new Date(now.getTime() - BERJALAN_MAKS_MS) } }, orderBy: { id: "asc" }, take: 5 });
    out.ai = rows.map((c) => ({ id: c.id, fitur: c.fitur as FiturAI, penyedia: c.penyedia, status: c.status, waktu: c.waktu.toISOString() }));
  } else if (k.ai < kursor.ai) {
    const rows = await db.aiCall.findMany({ where: { id: { gt: k.ai } }, orderBy: { id: "asc" }, take: 20 });
    out.ai = rows.map((c) => ({ id: c.id, fitur: c.fitur as FiturAI, penyedia: c.penyedia, status: c.status, waktu: c.waktu.toISOString() }));
  }
  if (k.cek?.length) {
    const rows = await db.aiCall.findMany({ where: { id: { in: k.cek.slice(0, 20) } }, select: { id: true, status: true, waktu: true } });
    out.cek = rows.map((c) => ({ id: c.id, status: c.status === "berjalan" && now.getTime() - c.waktu.getTime() > BERJALAN_MAKS_MS ? "terputus" : c.status }));
  }
  return out;
}
