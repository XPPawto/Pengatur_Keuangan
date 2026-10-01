import type { Db } from "../db";
import { planAllocation } from "../allocation";
import { rp } from "../money";
import { addDays, diffDays, fmtTanggal, HARI, sundayOnOrBefore, weekdayOf, wibDate, wibHM } from "../time";
import type { EnvelopeKode } from "../types";
import { logActivity, type Actor } from "./activity-log";
import { AppError } from "./errors";
import { getDailyStatus } from "./daily";
import { getBalances } from "./envelopes";
import { getGoalProgress } from "./goals";
import { getCurrentPeriod, getPeriodAllocations, getPlanFor, hariSisaPeriode } from "./periods";

/** Rata-rata pengeluaran per minggu per amplop (di luar pembayaran tagihan & hutang-piutang). */
export interface RataMingguan {
  makan: number;
  data: number;
  darurat: number;
  sampel: number;
  sumber: "riwayat" | "minggu_ini" | "rencana";
}

export async function rataPengeluaran(db: Db, now: Date): Promise<RataMingguan> {
  const selesai = await db.period.findMany({ where: { status: "selesai" }, orderBy: { tanggalMulai: "desc" }, take: 4 });
  const ambil = async (ids: number[], kode: string) =>
    (await db.transaction.aggregate({ _sum: { nominal: true }, where: { periodId: { in: ids }, billId: null, debtId: null, envelope: { kode } } }))._sum.nominal ?? 0;

  if (selesai.length) {
    const ids = selesai.map((p) => p.id);
    const n = selesai.length;
    return {
      makan: Math.round((await ambil(ids, "makan")) / n),
      data: Math.round((await ambil(ids, "data")) / n),
      darurat: Math.round((await ambil(ids, "darurat")) / n),
      sampel: n,
      sumber: "riwayat",
    };
  }
  const period = await getCurrentPeriod(db);
  if (period) {
    const today = wibDate(now);
    const hari = Math.max(1, Math.min(7, diffDays(period.tanggalMulai, today) + 1));
    const alloc = await getPeriodAllocations(db, period.id);
    const makan = await ambil([period.id], "makan");
    const darurat = await ambil([period.id], "darurat");
    return {
      // belum ada riwayat: pakai yang lebih besar antara laju minggu ini dan jatah (konservatif)
      makan: Math.max(alloc.makan, Math.round((makan / hari) * 7)),
      data: alloc.data,
      darurat: Math.round((darurat / hari) * 7),
      sampel: 0,
      sumber: "minggu_ini",
    };
  }
  const plan = await getPlanFor(db, sundayOnOrBefore(wibDate(now)));
  return { makan: plan.makan, data: plan.data, darurat: 0, sampel: 0, sumber: "rencana" };
}

export interface TagihanProyeksi {
  nama: string;
  nominal: number;
  jatuhTempo: string;
  kurang: number;
}

export interface MingguProyeksi {
  mulai: string;
  pemasukan: number;
  paylater: number;
  kado: number;
  darurat: number;
  tagihan: TagihanProyeksi[];
}

export interface ProyeksiOpts {
  minggu?: number;
  /** skenario: uang mingguan berbeda untuk beberapa minggu ke depan */
  pemasukan?: { nominal: number; jumlahMinggu: number };
  /** skenario: belanja sekali sekarang (diambil dari Darurat, kalau kurang dari Tabungan kado) */
  belanja?: { nominal: number; barang: string };
}

export interface Proyeksi {
  awal: { paylater: number; kado: number; darurat: number };
  minggu: MingguProyeksi[];
  rata: RataMingguan;
  kadoSaatTenggat: number | null;
  tenggat: string | null;
  daruratTerendah: number;
  kadoTerpakai: number;
  kurangTagihan: TagihanProyeksi[];
  risiko: string[];
}

/**
 * Proyeksi saldo amplop tabungan beberapa minggu ke depan berdasarkan rencana pembagian,
 * rata-rata pengeluaran nyata, dan tagihan yang belum lunas. Tidak menghitung kiriman tak tentu.
 */
export async function proyeksi(db: Db, now: Date, opts: ProyeksiOpts = {}): Promise<Proyeksi> {
  const n = opts.minggu ?? 8;
  const today = wibDate(now);
  const period = await getCurrentPeriod(db);
  const [balances, rata, goal, bills, daily] = await Promise.all([
    getBalances(db, period?.id ?? null),
    rataPengeluaran(db, now),
    db.goal.findFirst(),
    db.bill.findMany({ where: { status: "belum", envelope: { kode: "paylater" } }, orderBy: { jatuhTempo: "asc" } }),
    getDailyStatus(db, now),
  ]);
  const saldo = (k: EnvelopeKode) => balances.find((b) => b.kode === k)?.saldo ?? 0;
  let paylater = saldo("paylater");
  let kado = saldo("kado");
  let darurat = saldo("darurat");
  const awal = { paylater, kado, darurat };
  const out: MingguProyeksi[] = [];
  const kurangTagihan: TagihanProyeksi[] = [];
  let kadoTerpakai = 0;
  let daruratTerendah = darurat;

  const bayarTagihan = (dari: string, sampai: string): TagihanProyeksi[] => {
    const hasil: TagihanProyeksi[] = [];
    for (const b of bills.filter((x) => x.jatuhTempo >= dari && x.jatuhTempo <= sampai)) {
      paylater -= b.nominal;
      let kurang = 0;
      if (paylater < 0) {
        kurang = -paylater;
        darurat -= kurang; // ditutup dari Darurat
        paylater = 0;
      }
      const t = { nama: b.nama, nominal: b.nominal, jatuhTempo: b.jatuhTempo, kurang };
      hasil.push(t);
      if (kurang) kurangTagihan.push(t);
    }
    return hasil;
  };
  const tutupDarurat = () => {
    if (darurat < 0) {
      const ambil = Math.min(kado, -darurat);
      kado -= ambil;
      kadoTerpakai += ambil;
      darurat += ambil;
    }
    daruratTerendah = Math.min(daruratTerendah, darurat);
  };

  // Minggu berjalan: sisa hari periode ini
  const mulaiIni = period && period.tanggalSelesai >= today ? period.tanggalMulai : sundayOnOrBefore(today);
  const akhirIni = addDays(mulaiIni, 6);
  if (opts.belanja) {
    darurat -= opts.belanja.nominal;
    tutupDarurat();
  }
  if (period && period.tanggalSelesai >= today) {
    const hariSisa = hariSisaPeriode(period, today);
    const sisaMakan = daily?.saldoMakan ?? saldo("makan");
    const butuhMakan = Math.round((rata.makan / 7) * hariSisa);
    darurat += sisaMakan - butuhMakan; // sisa pindah ke Darurat, kalau kurang ditutup Darurat
    const dataTerpakai = balances.find((b) => b.kode === "data")?.terpakai ?? 0;
    const sisaData = saldo("data") - (dataTerpakai === 0 ? Math.min(rata.data, saldo("data")) : 0);
    darurat += Math.max(0, sisaData);
    darurat -= Math.round((rata.darurat / 7) * hariSisa);
  }
  const tagihanIni = bayarTagihan(today, akhirIni);
  tutupDarurat();
  out.push({ mulai: mulaiIni, pemasukan: period?.pemasukan ?? 0, paylater, kado, darurat, tagihan: tagihanIni });

  for (let i = 1; i < n; i++) {
    const mulai = addDays(mulaiIni, 7 * i);
    const akhir = addDays(mulai, 6);
    const plan = await getPlanFor(db, mulai);
    const rencana = Object.values(plan).reduce((a, b) => a + b, 0);
    const income = opts.pemasukan && i <= opts.pemasukan.jumlahMinggu ? opts.pemasukan.nominal : rencana;
    const next = bills.find((b) => b.jatuhTempo >= mulai);
    const { alloc } = planAllocation({ income, plan, hariKeTagihan: next ? diffDays(mulai, next.jatuhTempo) : null });
    paylater += alloc.paylater;
    kado += alloc.kado;
    darurat += alloc.darurat + (alloc.makan - rata.makan) + (alloc.data - rata.data) - rata.darurat;
    const tagihan = bayarTagihan(mulai, akhir);
    tutupDarurat();
    out.push({ mulai, pemasukan: income, paylater, kado, darurat, tagihan });
  }

  let kadoSaatTenggat: number | null = null;
  if (goal) {
    const w = [...out].reverse().find((m) => m.mulai <= goal.tenggat);
    kadoSaatTenggat = w ? w.kado : null;
  }

  const risiko: string[] = [];
  for (const t of kurangTagihan) risiko.push(`${t.nama} ${fmtTanggal(t.jatuhTempo)} diperkirakan kurang ${rp(t.kurang)} di amplop Paylater.`);
  if (goal && kadoSaatTenggat !== null && kadoSaatTenggat < goal.targetMin && today <= goal.tenggat) {
    risiko.push(`Tabungan kado diperkirakan ${rp(kadoSaatTenggat)} saat tenggat, kurang ${rp(goal.targetMin - kadoSaatTenggat)} dari minimal.`);
  }
  if (kadoTerpakai > 0) risiko.push(`Dana darurat diperkirakan habis; ${rp(kadoTerpakai)} terpaksa diambil dari tabungan kado.`);
  if (rata.sampel > 0 && rata.makan > (out[1] ? (await getPlanFor(db, out[1].mulai)).makan : rata.makan)) {
    risiko.push(`Rata-rata makan ${rp(rata.makan)}/minggu, di atas jatah. Sisanya terus menggerus Darurat.`);
  }

  return { awal, minggu: out, rata, kadoSaatTenggat, tenggat: goal?.tenggat ?? null, daruratTerendah, kadoTerpakai, kurangTagihan, risiko };
}

/** Simulasi "kalau…": bandingkan proyeksi dasar dengan skenario. */
export async function simulasi(db: Db, now: Date, skenario: Omit<ProyeksiOpts, "minggu">) {
  const [dasar, hasil, goal] = await Promise.all([proyeksi(db, now), proyeksi(db, now, skenario), db.goal.findFirst()]);
  const poin: string[] = [];
  if (dasar.kadoSaatTenggat !== null && hasil.kadoSaatTenggat !== null) {
    const beda = hasil.kadoSaatTenggat - dasar.kadoSaatTenggat;
    if (beda !== 0) {
      poin.push(`Tabungan kado saat tenggat: ${rp(dasar.kadoSaatTenggat)} → ${rp(hasil.kadoSaatTenggat)} (${beda < 0 ? "mundur" : "naik"} ${rp(Math.abs(beda))}).`);
    } else poin.push(`Tabungan kado tetap ${rp(hasil.kadoSaatTenggat)} saat tenggat.`);
    if (goal) {
      const amanDulu = dasar.kadoSaatTenggat >= goal.targetMin;
      const amanNanti = hasil.kadoSaatTenggat >= goal.targetMin;
      if (amanDulu && !amanNanti) poin.push(`Target minimal ${rp(goal.targetMin)} jadi TIDAK tercapai.`);
      else if (amanNanti) poin.push(`Target minimal ${rp(goal.targetMin)} masih aman.`);
    }
  }
  poin.push(`Dana darurat terendah: ${rp(dasar.daruratTerendah)} → ${rp(hasil.daruratTerendah)}.`);
  const tagihanBaru = hasil.kurangTagihan.filter((t) => !dasar.kurangTagihan.some((d) => d.jatuhTempo === t.jatuhTempo && d.kurang >= t.kurang));
  for (const t of tagihanBaru) poin.push(`${t.nama} ${fmtTanggal(t.jatuhTempo)} jadi kurang ${rp(t.kurang)}.`);
  if (hasil.kadoTerpakai > dasar.kadoTerpakai) poin.push(`Darurat nggak cukup, ${rp(hasil.kadoTerpakai - dasar.kadoTerpakai)} kepakai dari tabungan kado.`);
  const aman = hasil.kadoTerpakai === dasar.kadoTerpakai && tagihanBaru.length === 0 && (!goal || hasil.kadoSaatTenggat === null || hasil.kadoSaatTenggat >= goal.targetMin || dasar.kadoSaatTenggat === hasil.kadoSaatTenggat);
  return { dasar, hasil, poin, aman };
}

export interface SaranTransfer {
  dari: EnvelopeKode;
  ke: EnvelopeKode;
  nominal: number;
}

export interface Saran {
  judul: string;
  detail: string;
  tingkat: "info" | "penting";
  transfer?: SaranTransfer;
}

const PENYANGGA_DARURAT = 30_000;
const bulatRibu = (n: number) => Math.floor(n / 1000) * 1000;

/** Saran otomatis: amankan tagihan, kejar target, peringatan dana tipis. Transfer bisa dijalankan sekali `ok`. */
export async function saranMingguan(db: Db, now: Date): Promise<Saran[]> {
  const period = await getCurrentPeriod(db);
  if (!period) return [];
  const [p, goal, balances, daily] = await Promise.all([proyeksi(db, now), getGoalProgress(db, now), getBalances(db, period.id), getDailyStatus(db, now)]);
  const saldo = (k: EnvelopeKode) => balances.find((b) => b.kode === k)?.saldo ?? 0;
  let bebasDarurat = saldo("darurat") - PENYANGGA_DARURAT;
  const out: Saran[] = [];

  const tagihan = p.kurangTagihan.find((t) => diffDays(wibDate(now), t.jatuhTempo) <= 21);
  if (tagihan && bebasDarurat > 0) {
    const nominal = Math.min(bulatRibu(tagihan.kurang + 999), bulatRibu(bebasDarurat));
    if (nominal >= 1000) {
      out.push({
        judul: `Amankan ${tagihan.nama} ${fmtTanggal(tagihan.jatuhTempo)}`,
        detail: `Amplop Paylater diperkirakan kurang ${rp(tagihan.kurang)}. Pindahkan ${rp(nominal)} dari Darurat sekarang.`,
        tingkat: "penting",
        transfer: { dari: "darurat", ke: "paylater", nominal },
      });
      bebasDarurat -= nominal;
    }
  }

  if (goal && goal.hariLagi >= 0 && p.kadoSaatTenggat !== null && p.kadoSaatTenggat < goal.goal.targetMin) {
    let gap = goal.goal.targetMin - p.kadoSaatTenggat;
    if (daily && daily.hariSisa <= 1 && daily.saldoMakan > 0) {
      const n = Math.min(bulatRibu(daily.saldoMakan), bulatRibu(gap + 999));
      if (n >= 1000) {
        out.push({
          judul: "Sisa makan minggu ini ke tabungan kado",
          detail: `Daripada otomatis ke Darurat, sisa makan ${rp(n)} langsung ditabung untuk kado.`,
          tingkat: "penting",
          transfer: { dari: "makan", ke: "kado", nominal: n },
        });
        gap -= n;
      }
    }
    if (gap > 0 && bebasDarurat >= 5000) {
      const n = Math.min(bulatRibu(gap + 999), bulatRibu(bebasDarurat));
      if (n >= 5000) {
        out.push({
          judul: "Kejar target kado",
          detail: `Proyeksi kado ${rp(p.kadoSaatTenggat)} saat tenggat (kurang ${rp(goal.goal.targetMin - p.kadoSaatTenggat)}). Pindahkan ${rp(n)} dari Darurat, sisakan penyangga ${rp(PENYANGGA_DARURAT)}.`,
          tingkat: "penting",
          transfer: { dari: "darurat", ke: "kado", nominal: n },
        });
      }
    }
  }

  if (saldo("darurat") < 20_000) {
    out.push({ judul: "Dana darurat tipis", detail: `Darurat tinggal ${rp(saldo("darurat"))}. Tahan dulu belanja non-makan sampai uang mingguan berikutnya.`, tingkat: "penting" });
  }
  if (p.rata.sampel >= 2) {
    const alloc = await getPeriodAllocations(db, period.id);
    if (p.rata.makan > alloc.makan) {
      out.push({
        judul: "Makan rutin di atas jatah",
        detail: `Rata-rata ${rp(p.rata.makan)}/minggu vs jatah ${rp(alloc.makan)}. Coba batasi ${rp(Math.floor(alloc.makan / 7 / 100) * 100)}/hari.`,
        tingkat: "info",
      });
    }
  }
  return out;
}

/** Jalankan semua transfer saran sekaligus (satu aktivitas, bisa di-undo). */
export async function jalankanSaran(db: Db, transfers: SaranTransfer[], actor: Actor, now: Date) {
  const period = await getCurrentPeriod(db);
  if (!period) throw new AppError("no_period", "Belum ada periode aktif.");
  if (!transfers.length) throw new AppError("invalid", "Tidak ada saran yang bisa dijalankan.");
  const envs = await db.envelope.findMany();
  const ids: number[] = [];
  for (const t of transfers) {
    const dari = envs.find((e) => e.kode === t.dari)!;
    const ke = envs.find((e) => e.kode === t.ke)!;
    if (dari.terkunci) throw new AppError("locked", `${dari.nama} terkunci.`);
    const tr = await db.transfer.create({
      data: { periodId: period.id, dariEnvelopeId: dari.id, keEnvelopeId: ke.id, nominal: t.nominal, alasan: "Saran autopilot", dibuatPada: now },
    });
    ids.push(tr.id);
  }
  await logActivity(db, actor, "saran", `Jalankan saran autopilot: ${transfers.map((t) => `${rp(t.nominal)} ${t.dari}→${t.ke}`).join(", ")}`, {
    undo: { t: "jalankan_saran", transferIds: ids },
    now,
  });
  return ids.length;
}

export interface Pola {
  judul: string;
  detail: string;
}

/** Deteksi pola & anomali dari 4 minggu terakhir. */
export async function deteksiPola(db: Db, now: Date): Promise<Pola[]> {
  const today = wibDate(now);
  const dari = addDays(today, -27);
  const txs = await db.transaction.findMany({ where: { tanggal: { gte: dari }, billId: null, debtId: null }, include: { envelope: true } });
  const out: Pola[] = [];
  const makan = txs.filter((t) => t.envelope.kode === "makan");

  // hari boros
  const perTanggal = new Map<string, number>();
  for (const t of makan) perTanggal.set(t.tanggal, (perTanggal.get(t.tanggal) ?? 0) + t.nominal);
  const hari = [...perTanggal.entries()];
  if (hari.length >= 7) {
    const rata = hari.reduce((a, [, v]) => a + v, 0) / hari.length;
    const perHari = new Map<number, number[]>();
    for (const [tgl, v] of hari) perHari.set(weekdayOf(tgl), [...(perHari.get(weekdayOf(tgl)) ?? []), v]);
    const boros = [...perHari.entries()]
      .filter(([, vs]) => vs.length >= 2)
      .map(([h, vs]) => ({ h, avg: vs.reduce((a, b) => a + b, 0) / vs.length }))
      .filter((x) => x.avg > rata * 1.3)
      .sort((a, b) => b.avg - a.avg)[0];
    if (boros) {
      out.push({ judul: `${HARI[boros.h]} paling boros`, detail: `Rata-rata makan hari ${HARI[boros.h]} ${rp(Math.round(boros.avg))}, ${Math.round((boros.avg / rata - 1) * 100)}% di atas rata-rata harian ${rp(Math.round(rata))}.` });
    }
  }

  // jajan malam
  const malam = (t: (typeof txs)[number]) => wibHM(t.dibuatPada).jam >= 21;
  const batas = addDays(today, -13);
  const malamBaru = txs.filter((t) => t.tanggal >= batas && malam(t)).reduce((a, t) => a + t.nominal, 0);
  const malamLama = txs.filter((t) => t.tanggal < batas && malam(t)).reduce((a, t) => a + t.nominal, 0);
  if (malamBaru >= 10_000 && malamBaru > malamLama * 1.5) {
    out.push({ judul: "Jajan malam naik", detail: `Pengeluaran di atas jam 21.00 dua minggu terakhir ${rp(malamBaru)} (sebelumnya ${rp(malamLama)}).` });
  }

  // item terbesar
  const perItem = new Map<string, number>();
  for (const t of txs) {
    const k = (t.catatan || "lainnya").toLowerCase().split(/\s+/)[0];
    perItem.set(k, (perItem.get(k) ?? 0) + t.nominal);
  }
  const top = [...perItem.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (top.length) out.push({ judul: "Paling banyak menyedot uang", detail: top.map(([k, v]) => `${k} ${rp(v)}`).join(" · ") + " (4 minggu terakhir)." });

  // lonjakan darurat minggu ini
  const period = await getCurrentPeriod(db);
  if (period) {
    const rataP = await rataPengeluaran(db, now);
    const daruratIni = txs.filter((t) => t.periodId === period.id && t.envelope.kode === "darurat").reduce((a, t) => a + t.nominal, 0);
    if (rataP.sampel >= 2 && rataP.darurat > 0 && daruratIni > rataP.darurat * 2) {
      out.push({ judul: "Darurat minggu ini melonjak", detail: `${rp(daruratIni)} vs rata-rata ${rp(rataP.darurat)}/minggu.` });
    }
  }
  return out;
}
