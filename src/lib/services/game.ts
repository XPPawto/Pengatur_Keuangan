import type { Db } from "../db";
import { rp } from "../money";
import { HARI, addDays, wibDate, weekdayOf } from "../time";
import { getStreak } from "./daily";
import { getGoalProgress } from "./goals";
import { getCurrentPeriod } from "./periods";
import { laporanKeluargaText, rekapMingguanText, weekSummary, type WeekSummary } from "./reports";
import { ringkasanDebt } from "./debts";

export interface SkorRincian {
  total: number;
  disiplin: number;
  makan: number;
  tanpaJajan: number;
  tahan: number;
  tagihan: number;
}

/**
 * Skor mingguan 0–100:
 * disiplin mencatat 40 · makan dalam jatah 30 · hari tanpa jajan 10 · tahan belanja 10 · tagihan tidak telat 10
 */
export function hitungSkor(s: WeekSummary, x: { hariTanpaJajan: number; tahanBatal: number; tagihanTelat: number }): SkorRincian {
  const disiplin = Math.round((s.hariDisiplin / Math.max(1, s.hariBerjalan)) * 40);
  const alok = s.perAmplop.find((a) => a.kode === "makan")?.alokasi ?? 0;
  const proporsional = alok ? (alok * s.hariBerjalan) / 7 : 0;
  let makan = 30;
  if (proporsional > 0 && s.makan > proporsional) makan = Math.max(0, Math.round(30 * (1 - ((s.makan - proporsional) / proporsional) * 2)));
  const tanpaJajan = Math.min(2, x.hariTanpaJajan) * 5;
  const tahan = Math.min(2, x.tahanBatal) * 5;
  const tagihan = x.tagihanTelat ? 0 : 10;
  return { total: disiplin + makan + tanpaJajan + tahan + tagihan, disiplin, makan, tanpaJajan, tahan, tagihan };
}

async function skorPeriode(db: Db, periodId: number, now: Date) {
  const s = await weekSummary(db, periodId, now);
  if (!s) return null;
  const [nol, tahan, telat] = await Promise.all([
    db.dailyLog.count({ where: { tanggal: { gte: s.period.tanggalMulai, lte: s.period.tanggalSelesai }, tanpaJajan: true } }),
    db.holdRequest.count({ where: { hasil: "batal", diputuskanPada: { gte: new Date(`${s.period.tanggalMulai}T00:00:00+07:00`), lt: new Date(`${addDays(s.period.tanggalSelesai, 1)}T00:00:00+07:00`) } } }),
    db.bill.count({ where: { status: "belum", jatuhTempo: { gte: s.period.tanggalMulai, lt: wibDate(now) < s.period.tanggalSelesai ? wibDate(now) : s.period.tanggalSelesai } } }),
  ]);
  return { ringkasan: s, skor: hitungSkor(s, { hariTanpaJajan: nol, tahanBatal: tahan, tagihanTelat: telat }) };
}

export const GELAR = ["Pemula", "Mulai Rapi", "Hemat", "Disiplin", "Master Amplop", "Sultan Kos", "Legenda Hemat"];

export function levelDariXp(xp: number) {
  const level = Math.floor(Math.sqrt(xp / 60)) + 1;
  const xpLevelIni = 60 * (level - 1) ** 2;
  const xpBerikut = 60 * level ** 2;
  return { level, gelar: GELAR[Math.min(level - 1, GELAR.length - 1)], xp, xpLevelIni, xpBerikut };
}

export interface Lencana {
  kode: string;
  nama: string;
  deskripsi: string;
  didapat: boolean;
}

export interface Tantangan {
  judul: string;
  progres: number; // 0..1
  keterangan: string;
  selesai: boolean;
  gagal: boolean;
}

export async function getPrestasi(db: Db, now: Date) {
  const periods = await db.period.findMany({ where: { status: { not: "menunggu" } }, orderBy: { tanggalMulai: "asc" } });
  const riwayat = [];
  for (const p of periods) {
    const r = await skorPeriode(db, p.id, now);
    if (r) riwayat.push({ periodId: p.id, mulai: p.tanggalMulai, skor: r.skor, ringkasan: r.ringkasan });
  }
  const xp = riwayat.reduce((a, r) => a + r.skor.total, 0);
  const level = levelDariXp(xp);
  const ini = riwayat[riwayat.length - 1] ?? null;

  const [streak, goal, holdsBatal, billsTepat, recCocok, txCount] = await Promise.all([
    getStreak(db, now),
    getGoalProgress(db, now),
    db.holdRequest.count({ where: { hasil: "batal" } }),
    db.bill.findMany({ where: { status: "lunas", dibayarPada: { not: null } } }),
    db.reconciliation.count({ where: { selisih: 0 } }),
    db.transaction.count(),
  ]);
  const tepatWaktu = billsTepat.filter((b) => wibDate(b.dibayarPada!) <= b.jatuhTempo).length;
  const mingguHemat = riwayat.filter((r) => r.ringkasan.period.tanggalSelesai < wibDate(now) && r.ringkasan.makan <= (r.ringkasan.perAmplop.find((a) => a.kode === "makan")?.alokasi ?? 0));
  let berturut = 0;
  let maksBerturut = 0;
  for (const r of riwayat.filter((x) => x.ringkasan.period.tanggalSelesai < wibDate(now))) {
    const ok = r.ringkasan.makan <= (r.ringkasan.perAmplop.find((a) => a.kode === "makan")?.alokasi ?? 0);
    berturut = ok ? berturut + 1 : 0;
    maksBerturut = Math.max(maksBerturut, berturut);
  }

  const lencana: Lencana[] = [
    { kode: "streak7", nama: "Seminggu Penuh", deskripsi: "Mencatat 7 hari berturut-turut", didapat: streak >= 7 },
    { kode: "streak30", nama: "Sebulan Konsisten", deskripsi: "Mencatat 30 hari berturut-turut", didapat: streak >= 30 },
    { kode: "hemat1", nama: "Minggu Hemat", deskripsi: "Satu minggu makan tidak lewat jatah", didapat: mingguHemat.length >= 1 },
    { kode: "hemat3", nama: "Tiga Minggu Hemat", deskripsi: "Tiga minggu berturut-turut makan dalam jatah", didapat: maksBerturut >= 3 },
    { kode: "tahan3", nama: "Penahan Godaan", deskripsi: "Tiga kali tidak jadi beli lewat mode tahan belanja", didapat: holdsBatal >= 3 },
    { kode: "tepat3", nama: "Tepat Waktu", deskripsi: "Tiga tagihan dibayar sebelum jatuh tempo", didapat: tepatWaktu >= 3 },
    { kode: "skor90", nama: "Nyaris Sempurna", deskripsi: "Skor mingguan 90 ke atas", didapat: riwayat.some((r) => r.skor.total >= 90) },
    { kode: "rapi", nama: "Pembukuan Rapi", deskripsi: "Saldo asli cocok persis dengan catatan", didapat: recCocok >= 1 },
    { kode: "rajin100", nama: "Pencatat Rajin", deskripsi: "100 transaksi tercatat", didapat: txCount >= 100 },
    { kode: "kado", nama: "Target Tercapai", deskripsi: "Tabungan kado mencapai target minimal", didapat: !!goal && goal.saldo >= goal.goal.targetMin },
  ];

  // Tantangan minggu ini, dihitung langsung dari data
  const tantangan: Tantangan[] = [];
  const period = await getCurrentPeriod(db);
  if (period && ini) {
    const s = ini.ringkasan;
    const alok = s.perAmplop.find((a) => a.kode === "makan")?.alokasi ?? 0;
    const selesaiMinggu = wibDate(now) >= s.period.tanggalSelesai;
    tantangan.push({
      judul: `Makan minggu ini ≤ ${rp(alok)}`,
      progres: alok ? Math.min(1, s.makan / alok) : 0,
      keterangan: `${rp(s.makan)} terpakai`,
      selesai: selesaiMinggu && s.makan <= alok,
      gagal: s.makan > alok,
    });
    const nol = await db.dailyLog.count({ where: { tanggal: { gte: s.period.tanggalMulai, lte: s.period.tanggalSelesai }, tanpaJajan: true } });
    tantangan.push({ judul: "2 hari tanpa jajan", progres: Math.min(1, nol / 2), keterangan: `${nol}/2 hari`, selesai: nol >= 2, gagal: false });
    tantangan.push({ judul: "Catat setiap hari", progres: s.hariDisiplin / 7, keterangan: `${s.hariDisiplin}/7 hari`, selesai: s.hariDisiplin >= 7, gagal: s.hariBerjalan - s.hariDisiplin > 1 });

    // tantangan dari pola: hari paling boros minggu-minggu sebelumnya
    const lalu = await db.transaction.findMany({ where: { tanggal: { gte: addDays(s.period.tanggalMulai, -28), lt: s.period.tanggalMulai }, envelope: { kode: "makan" }, billId: null, debtId: null } });
    if (lalu.length >= 7) {
      const perHari = new Map<number, number>();
      const tglPerHari = new Map<number, Set<string>>();
      for (const t of lalu) {
        const h = weekdayOf(t.tanggal);
        perHari.set(h, (perHari.get(h) ?? 0) + t.nominal);
        tglPerHari.set(h, (tglPerHari.get(h) ?? new Set()).add(t.tanggal));
      }
      const [h, total] = [...perHari.entries()].sort((a, b) => b[1] / tglPerHari.get(b[0])!.size - a[1] / tglPerHari.get(a[0])!.size)[0];
      const batas = Math.floor(alok / 7 / 100) * 100;
      const avg = total / tglPerHari.get(h)!.size;
      if (avg > batas) {
        const tgl = Array.from({ length: 7 }, (_, i) => addDays(s.period.tanggalMulai, i)).find((d) => weekdayOf(d) === h)!;
        const nilai = (await db.transaction.aggregate({ _sum: { nominal: true }, where: { tanggal: tgl, envelope: { kode: "makan" }, debtId: null } }))._sum.nominal ?? 0;
        const lewat = wibDate(now) > tgl;
        tantangan.push({
          judul: `${HARI[h]} di bawah ${rp(batas)}`,
          progres: batas ? Math.min(1, nilai / batas) : 0,
          keterangan: `biasanya ${rp(Math.round(avg))}${wibDate(now) >= tgl ? `, kali ini ${rp(nilai)}` : ""}`,
          selesai: lewat && nilai <= batas,
          gagal: nilai > batas,
        });
      }
    }
  }

  return { level, skorIni: ini?.skor ?? null, riwayat: riwayat.map((r) => ({ mulai: r.mulai, skor: r.skor.total })), lencana, tantangan, streak };
}

export function teksSkor(p: Awaited<ReturnType<typeof getPrestasi>>): string {
  const baris = [`*Skor minggu ini: ${p.skorIni?.total ?? 0}/100*`];
  if (p.skorIni) {
    const s = p.skorIni;
    baris.push(`Disiplin ${s.disiplin}/40 · Makan ${s.makan}/30 · Tanpa jajan ${s.tanpaJajan}/10 · Tahan belanja ${s.tahan}/10 · Tagihan ${s.tagihan}/10`);
  }
  baris.push(`Level ${p.level.level} — ${p.level.gelar} (${p.level.xp} XP, ${p.level.xpBerikut - p.level.xp} lagi ke level berikutnya)`);
  baris.push(`Lencana ${p.lencana.filter((l) => l.didapat).length}/${p.lencana.length}: ${p.lencana.filter((l) => l.didapat).map((l) => l.nama).join(", ") || "belum ada"}`);
  if (p.tantangan.length) {
    baris.push("", "*Tantangan minggu ini*");
    for (const t of p.tantangan) baris.push(`${t.selesai ? "[selesai]" : t.gagal ? "[gagal]" : "[jalan]"} ${t.judul} — ${t.keterangan}`);
  }
  return baris.join("\n");
}

/** Rekap mingguan pemilik + skor & piutang yang belum kembali. */
export async function rekapLengkap(db: Db, periodId: number, now: Date): Promise<string | null> {
  const dasar = await rekapMingguanText(db, periodId, now);
  if (!dasar) return null;
  const [p, debts] = await Promise.all([getPrestasi(db, now), ringkasanDebt(db, now)]);
  const baris = [dasar];
  if (p.skorIni) baris.push(`Skor minggu ini ${p.skorIni.total}/100 · Level ${p.level.level} ${p.level.gelar}.`);
  const lama = debts.rows.filter((d) => d.arah === "piutang" && d.umurHari >= 7);
  if (lama.length) baris.push(`Piutang belum kembali: ${lama.map((d) => `${d.orang} ${rp(d.sisa)} (${d.umurHari} hari)`).join(", ")}.`);
  return baris.join("\n");
}

/** Laporan keluarga + skor kedisiplinan. */
export async function laporanKeluargaLengkap(db: Db, periodId: number, now: Date, nama: string): Promise<string | null> {
  const dasar = await laporanKeluargaText(db, periodId, now, nama);
  if (!dasar) return null;
  const p = await getPrestasi(db, now);
  if (!p.skorIni) return dasar;
  return dasar.replace("\n\n_Pesan otomatis", `\nSkor kedisiplinan minggu ini: ${p.skorIni.total}/100.\n\n_Pesan otomatis`);
}
