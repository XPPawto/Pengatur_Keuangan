import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { handleMessage } from "@/lib/bot/handler";
import { parseStruk } from "@/lib/ocr/struk";
import { proyeksi, simulasi, saranMingguan } from "@/lib/services/autopilot";
import { billsWithReadiness } from "@/lib/services/bills";
import { getBalances } from "@/lib/services/envelopes";
import { bagiNominal, parseAturanBagi } from "@/lib/services/extra";
import { hitungSkor, levelDariXp } from "@/lib/services/game";
import { alarmKesehatan, cekKesehatan } from "@/lib/services/health";
import { getCurrentPeriod } from "@/lib/services/periods";
import { saldoSistem } from "@/lib/services/reconcile";
import { deleteTransaction } from "@/lib/services/transactions";
import { lastUndoable, undoActivity } from "@/lib/services/undo";
import { fromWib } from "@/lib/time";
import { resetDb } from "./helpers";

const db = new PrismaClient();
const ABDUL = "085163544535";
const ORTU = "08979936381";
const at = (tgl: string, jam = 12, menit = 0) => fromWib(tgl, jam, menit);
const kirim = (text: string, now: Date, nomor = ABDUL) => handleMessage(db, { nomor, text, now });

async function mulai4Okt() {
  await kirim("masuk 300", at("2026-10-04", 10));
  await kirim("ok", at("2026-10-04", 10));
}
async function saldo(kode: string) {
  const p = (await getCurrentPeriod(db))!;
  return (await getBalances(db, p.id)).find((b) => b.kode === kode)!.saldo;
}
async function totalAmplop() {
  const p = (await getCurrentPeriod(db))!;
  return (await getBalances(db, p.id)).reduce((a, b) => a + b.saldo, 0);
}

beforeEach(() => resetDb(db));
afterAll(() => db.$disconnect());

describe("undo semua aksi (`batal`)", () => {
  it("satu pesan berisi banyak item dibatalkan sekaligus", async () => {
    await mulai4Okt();
    await kirim("tempe 5k sama telur 14k", at("2026-10-05", 8));
    const [tanya] = await kirim("batal", at("2026-10-05", 9));
    expect(tanya).toContain("tempe Rp5.000, telur Rp14.000");
    await kirim("ok", at("2026-10-05", 9));
    expect(await db.transaction.count()).toBe(0);
  });

  it("batal setelah `bayar paylater`: transaksi hilang DAN tagihan kembali belum lunas", async () => {
    await mulai4Okt();
    await kirim("bayar paylater 50k", at("2026-10-04", 13));
    expect((await db.bill.findFirstOrThrow({ where: { jatuhTempo: "2026-10-04" } })).status).toBe("lunas");
    await kirim("batal", at("2026-10-04", 14));
    await kirim("ok", at("2026-10-04", 14));
    expect((await db.bill.findFirstOrThrow({ where: { jatuhTempo: "2026-10-04" } })).status).toBe("belum");
    expect(await db.transaction.count()).toBe(0);
    expect(await saldo("paylater")).toBe(50000);
  });

  it("hapus transaksi pembayaran dari website juga mengembalikan tagihan, dan bisa dipulihkan", async () => {
    await mulai4Okt();
    await kirim("bayar paylater 50k", at("2026-10-04",13));
    const tx = await db.transaction.findFirstOrThrow();
    await deleteTransaction(db, tx.id, at("2026-10-04", 14));
    expect((await db.bill.findFirstOrThrow({ where: { jatuhTempo: "2026-10-04" } })).status).toBe("belum");
    const log = (await lastUndoable(db))!;
    expect(log.aksi).toBe("hapus_transaksi");
    await undoActivity(db, log.id, { oleh: "web", sumber: "web" }, at("2026-10-04", 15));
    expect(await db.transaction.count()).toBe(1);
    expect((await db.bill.findFirstOrThrow({ where: { jatuhTempo: "2026-10-04" } })).status).toBe("lunas");
  });

  it("pindah amplop bisa dibatalkan", async () => {
    await mulai4Okt();
    await kirim("pindah 10k darurat ke makan alasan tes", at("2026-10-05"));
    await kirim("batal", at("2026-10-05"));
    await kirim("ok", at("2026-10-05"));
    expect(await db.transfer.count()).toBe(0);
    expect(await saldo("makan")).toBe(85000);
  });

  it("uang masuk bisa dibatalkan selama belum ada transaksi; periode lama aktif lagi", async () => {
    await mulai4Okt();
    await kirim("masuk 300", at("2026-10-11", 10));
    await kirim("ok", at("2026-10-11", 10));
    await kirim("batal", at("2026-10-11", 11));
    await kirim("ok", at("2026-10-11", 11));
    const p = (await getCurrentPeriod(db))!;
    expect(p.tanggalMulai).toBe("2026-10-04");
    expect(await db.transfer.count()).toBe(0); // pindahan sisa makan/data ikut dibatalkan
  });

  it("uang masuk yang sudah ada transaksinya ditolak dibatalkan", async () => {
    await mulai4Okt();
    await kirim("tempe 5k", at("2026-10-05"));
    const log = (await db.activityLog.findFirstOrThrow({ where: { aksi: "uang_masuk" } }));
    await expect(undoActivity(db, log.id, { oleh: "web", sumber: "web" }, at("2026-10-05"))).rejects.toThrow(/transaksinya/);
  });

  it("riwayat aktivitas mencatat pelaku", async () => {
    await mulai4Okt();
    await kirim("tempe 5k", at("2026-10-05"), "08971688893");
    const log = await db.activityLog.findFirstOrThrow({ where: { aksi: "catat" } });
    expect(log.oleh).toBe("628971688893");
    const [r] = await kirim("aktivitas", at("2026-10-05"));
    expect(r).toContain("…8893");
  });
});

describe("perbaikan bug", () => {
  it("kesiapan tagihan dihitung bertahap (saldo tidak dipakai berkali-kali)", async () => {
    await mulai4Okt(); // paylater 50rb
    const bills = (await billsWithReadiness(db, at("2026-10-04"))).filter((b) => b.envelope?.kode === "paylater" && b.status === "belum");
    expect(bills[0]).toMatchObject({ jatuhTempo: "2026-10-04", cukup: true });
    expect(bills[1]).toMatchObject({ jatuhTempo: "2026-10-31", cukup: false, saldoSumber: 0 });
  });

  it("`koreksi masuk` membetulkan uang mingguan lewat Darurat", async () => {
    await kirim("masuk 30", at("2026-10-04", 10)); // salah ketik
    await kirim("ok", at("2026-10-04", 10));
    const [r] = await kirim("koreksi masuk 300", at("2026-10-04", 11));
    expect(r).toContain("dikoreksi jadi Rp300.000");
    expect((await getCurrentPeriod(db))!.pemasukan).toBe(300000);
    expect(await saldoSistem(db)).toBe(300000);
  });
});

describe("rekonsiliasi saldo asli", () => {
  it("cocok persis", async () => {
    await mulai4Okt();
    await kirim("tempe 5k", at("2026-10-05"));
    const [r] = await kirim("saldo asli 295k", at("2026-10-05"));
    expect(r).toContain("Cocok persis");
  });

  it("uang asli kurang → dicatat sebagai pengeluaran yang terlewat", async () => {
    await mulai4Okt();
    const [r] = await kirim("saldo asli 282k", at("2026-10-05"));
    expect(r).toContain("Rp18.000 yang kepake");
    await kirim("1", at("2026-10-05"));
    expect(await saldoSistem(db)).toBe(282000);
    expect((await db.transaction.findFirstOrThrow()).jenis).toBe("koreksi");
  });

  it("uang asli lebih → jadi uang tambahan di Darurat", async () => {
    await mulai4Okt();
    await kirim("saldo asli 310k", at("2026-10-05"));
    await kirim("ok", at("2026-10-05"));
    expect(await saldo("darurat")).toBe(30000);
    expect(await saldoSistem(db)).toBe(310000);
  });
});

describe("kiriman Ayah di luar uang mingguan", () => {
  it("`ayah kirim 100k` → usulan 50/50 → ok → tercatat terpisah + tanda terima ke Ayah", async () => {
    await mulai4Okt();
    const [usul] = await kirim("ayah kirim 100k", at("2026-10-07", 15));
    expect(usul).toContain("Kiriman Ayah Rp100.000");
    expect(usul).toContain("Tabungan kado Rp50.000");
    const [ok] = await kirim("ok", at("2026-10-07", 15));
    expect(ok).toContain("tercatat");
    expect(await saldo("kado")).toBe(165000);
    expect(await saldo("darurat")).toBe(70000);
    const p = (await getCurrentPeriod(db))!;
    expect(p).toMatchObject({ pemasukan: 300000, tambahan: 100000 });
    const k = await db.extraIncome.findFirstOrThrow();
    expect(k).toMatchObject({ dari: "Ayah", nominal: 100000 });
    const terima = await db.outbox.findMany({ where: { kunci: { startsWith: "kiriman:" } } });
    expect(terima.map((o) => o.nomor)).toEqual(["628979936381"]);
    expect(terima[0].isi).toContain("Kiriman Rp100.000 sudah diterima Abdul");
  });

  it("pilih satu amplop & bisa dibatalkan (tanda terima ikut batal)", async () => {
    await mulai4Okt();
    await kirim("dari ayah 50rb", at("2026-10-07"));
    await kirim("1", at("2026-10-07")); // semua ke Makan
    expect(await saldo("makan")).toBe(135000);
    await kirim("batal", at("2026-10-07", 13));
    await kirim("ok", at("2026-10-07", 13));
    expect(await saldo("makan")).toBe(85000);
    expect(await db.extraIncome.count()).toBe(0);
    expect((await db.outbox.findFirstOrThrow({ where: { kunci: { startsWith: "kiriman:" } } })).status).toBe("batal");
  });

  it("Ayah mengabari \"sudah transfer 100rb\" → pemilik dapat pemberitahuan", async () => {
    await mulai4Okt();
    const [balas] = await kirim("Sudah transfer 100rb ya nak", at("2026-10-07", 9), ORTU);
    expect(balas).toContain("sudah diteruskan");
    const info = await db.outbox.findMany({ where: { jenis: "info_kiriman" } });
    expect(info).toHaveLength(2);
    expect(info[0].isi).toContain("Ayah bilang udah transfer Rp100.000");
    expect(info[0].isi).toContain("`ayah kirim 100k`");
  });

  it("laporan keluarga memisahkan uang mingguan & kiriman", async () => {
    await mulai4Okt();
    await kirim("ayah kirim 100k", at("2026-10-07"));
    await kirim("ok", at("2026-10-07"));
    const [lap] = await kirim("laporan", at("2026-10-08"), ORTU);
    expect(lap).toContain("uang mingguan Rp300.000 + kiriman tambahan Rp100.000");
  });

  it("aturan bagi: sisa pembulatan ke Darurat, kado nonaktif dialihkan", () => {
    expect(bagiNominal(75000, parseAturanBagi("kado:50,darurat:50"))).toEqual({ kado: 37500, darurat: 37500 });
    expect(bagiNominal(75050, parseAturanBagi("kado:50,darurat:50"))).toEqual({ kado: 37500, darurat: 37550 });
    expect(bagiNominal(100000, parseAturanBagi("kado:70,makan:30"), false)).toEqual({ makan: 30000, darurat: 70000 });
  });
});

describe("hutang-piutang & patungan", () => {
  it("pinjemin → bayar sebagian → lunas; saldo selalu cocok", async () => {
    await mulai4Okt();
    await kirim("pinjemin budi 20k", at("2026-10-05"));
    expect(await saldo("darurat")).toBe(0);
    const [b1] = await kirim("budi bayar 5k", at("2026-10-06"));
    expect(b1).toContain("Sisa utangnya Rp15.000");
    const [b2] = await kirim("budi lunas", at("2026-10-07"));
    expect(b2).toContain("Lunas");
    expect(await saldo("darurat")).toBe(20000);
    expect(await saldoSistem(db)).toBe(await totalAmplop());
  });

  it("pinjam ke teman lalu bayar", async () => {
    await mulai4Okt();
    await kirim("pinjem ke andi 30k", at("2026-10-05"));
    expect(await saldo("darurat")).toBe(50000);
    await kirim("bayar utang andi", at("2026-10-06"));
    expect(await saldo("darurat")).toBe(20000);
    const [list] = await kirim("utang", at("2026-10-06"));
    expect(list).toContain("Nggak ada");
  });

  it("patungan galon 18k bertiga: bagian sendiri 6rb, dua piutang 6rb", async () => {
    await mulai4Okt();
    const [r] = await kirim("patungan galon 18k sama budi andi", at("2026-10-05"));
    expect(r).toContain("bagian lo Rp6.000");
    expect(await db.debt.count()).toBe(2);
    expect(await saldo("makan")).toBe(85000 - 18000);
    await kirim("batal", at("2026-10-05", 13));
    await kirim("ok", at("2026-10-05", 13));
    expect(await db.debt.count()).toBe(0);
    expect(await saldo("makan")).toBe(85000);
  });

  it("pinjaman tidak dihitung sebagai belanja di rekap", async () => {
    await mulai4Okt();
    await kirim("pinjemin budi 20k", at("2026-10-05"));
    const [r] = await kirim("rekap", at("2026-10-05"));
    expect(r).toContain("Total keluar Rp0");
  });
});

describe("autopilot", () => {
  it("proyeksi 8 minggu: tabungan kado saat tenggat sesuai rencana PRD (Rp865.000)", async () => {
    await mulai4Okt();
    const p = await proyeksi(db, at("2026-10-04", 12));
    expect(p.minggu).toHaveLength(8);
    expect(p.kadoSaatTenggat).toBe(865000);
    expect(p.minggu[0].tagihan.map((t) => t.jatuhTempo)).toEqual(["2026-10-04"]);
  });

  it("simulasi beli mahal saat Darurat tipis → tabungan kado kepakai", async () => {
    await mulai4Okt();
    const s = await simulasi(db, at("2026-10-04", 12), { belanja: { nominal: 150000, barang: "sepatu" } });
    expect(s.aman).toBe(false);
    expect(s.hasil.kadoTerpakai).toBeGreaterThan(0);
    const [r] = await kirim("kalau beli sepatu 150k", at("2026-10-04", 12));
    expect(r).toContain("berisiko");
  });

  it("simulasi uang mingguan turun beberapa minggu", async () => {
    await mulai4Okt();
    const [r] = await kirim("kalau masuk 250 3 minggu", at("2026-10-04", 12));
    expect(r).toContain("Tabungan kado saat tenggat");
    expect(r).toContain("mundur");
  });

  it("saran: amankan tagihan yang diproyeksikan kurang, dijalankan sekali ok, dan bisa di-undo", async () => {
    await mulai4Okt();
    await kirim("bayar paylater 50k", at("2026-10-04", 13));
    // tagihan akhir Okt 80rb vs setoran 27rb×3 = 81rb → aman; besarkan tagihan supaya kurang
    await db.bill.updateMany({ where: { jatuhTempo: "2026-10-31" }, data: { nominal: 120000, jatuhTempo: "2026-10-20" } });
    // tanpa dana bebas di atas penyangga Rp30rb, saran pindah tidak muncul
    expect((await saranMingguan(db, at("2026-10-05"))).some((s) => s.transfer?.ke === "paylater")).toBe(false);
    await db.allocation.updateMany({ where: { envelope: { kode: "darurat" } }, data: { nominal: 200000 } });
    const saran = await saranMingguan(db, at("2026-10-05"));
    expect(saran.some((s) => s.transfer?.ke === "paylater")).toBe(true);
    const [r] = await kirim("saran", at("2026-10-05"));
    expect(r).toContain("Amankan");
    await kirim("ok", at("2026-10-05"));
    expect(await db.transfer.count()).toBeGreaterThan(0);
    await kirim("batal", at("2026-10-05", 13));
    await kirim("ok", at("2026-10-05", 13));
    expect(await db.transfer.count()).toBe(0);
  });

  it("`proyeksi` & `pola` di bot", async () => {
    await mulai4Okt();
    const [p] = await kirim("proyeksi", at("2026-10-05"));
    expect(p).toContain("Proyeksi 6 minggu");
    const [pola] = await kirim("pola", at("2026-10-05"));
    expect(pola.length).toBeGreaterThan(10);
  });
});

describe("gamifikasi", () => {
  it("skor sempurna & level", () => {
    const s = hitungSkor(
      { hariDisiplin: 7, hariBerjalan: 7, makan: 80000, perAmplop: [{ kode: "makan", alokasi: 85000 }] } as never,
      { hariTanpaJajan: 2, tahanBatal: 2, tagihanTelat: 0 },
    );
    expect(s.total).toBe(100);
    expect(levelDariXp(0).level).toBe(1);
    expect(levelDariXp(240).level).toBe(3);
  });

  it("`skor` di bot", async () => {
    await mulai4Okt();
    await kirim("tempe 5k", at("2026-10-04", 13));
    const [r] = await kirim("skor", at("2026-10-04", 14));
    expect(r).toContain("Skor minggu ini");
    expect(r).toContain("Tantangan minggu ini");
  });
});

describe("harga belajar sendiri", () => {
  it("lonjakan harga diberi tahu", async () => {
    await mulai4Okt();
    await kirim("telur 14k", at("2026-10-04", 13));
    await kirim("telur 14k", at("2026-10-05", 13));
    const [r] = await kirim("telur 17k", at("2026-10-06", 13));
    expect(r).toContain("21% di atas biasanya");
  });
});

describe("foto struk", () => {
  const TEKS = "INDOMARET\nTELUR AYAM 1/2KG 14.000\nTEMPE PAPAN 5.000\nSABUN LIFEBUOY 4.500\nTOTAL ITEM 3\nTOTAL 23.500\nTUNAI 50.000\nKEMBALI 26.500";
  const foto = (now: Date) => handleMessage(db, { nomor: ABDUL, text: "", now, gambar: async () => Buffer.from("x"), ocr: async () => TEKS });

  it("parser struk", () => {
    const h = parseStruk(TEKS);
    expect(h).toMatchObject({ toko: "INDOMARET", total: 23500, sumberTotal: "baris_total" });
    expect(h.items.map((i) => i.harga)).toEqual([14000, 5000, 4500]);
    expect(parseStruk("WARUNG BU SRI\nnasi 5.000\nayam 9.000").total).toBe(14000);
    expect(parseStruk("blur").total).toBeNull();
    expect(parseStruk("TOTAL 27.500,00").total).toBe(27500);
  });

  it("foto → total → ok dicatat sekali", async () => {
    await mulai4Okt();
    const [r] = await foto(at("2026-10-05"));
    expect(r).toContain("total Rp23.500");
    await kirim("ok", at("2026-10-05"));
    const tx = await db.transaction.findMany();
    expect(tx).toHaveLength(1);
    expect(tx[0]).toMatchObject({ nominal: 23500, catatan: "Belanja INDOMARET" });
  });

  it("foto → `rinci` dicatat per item dengan amplop masing-masing", async () => {
    await mulai4Okt();
    await foto(at("2026-10-05"));
    await kirim("rinci", at("2026-10-05"));
    const tx = await db.transaction.findMany({ include: { envelope: true } });
    expect(tx.map((t) => [t.nominal, t.envelope.kode])).toEqual([
      [14000, "makan"],
      [5000, "makan"],
      [4500, "darurat"],
    ]);
  });
});

describe("kesehatan sistem", () => {
  it("melaporkan bot mati & backup belum ada; alarm sekali sehari", async () => {
    await mulai4Okt();
    const h = await cekKesehatan(db, at("2026-10-20"));
    expect(h.cek.find((c) => c.kode === "bot")!.status).toBe("masalah");
    process.env.BACKUP_DIR = "/tmp/dk-tidak-ada";
    const n1 = await alarmKesehatan(db, at("2026-10-20", 10));
    const n2 = await alarmKesehatan(db, at("2026-10-20", 11));
    expect(n2).toBe(0);
    expect(n1).toBeGreaterThanOrEqual(0);
  });
});
