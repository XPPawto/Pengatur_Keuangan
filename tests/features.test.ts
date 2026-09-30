import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { handleMessage } from "@/lib/bot/handler";
import { rencanaKirim, isJamTenang, waktuBolehKirim } from "@/lib/delivery";
import { backupDatabase, listBackups } from "@/lib/services/backup";
import { getBalances } from "@/lib/services/envelopes";
import { buildWorkbook, buildTransactionsCsv } from "@/lib/services/export";
import { getGoalProgress } from "@/lib/services/goals";
import { requestLoginCode, verifyLoginCode } from "@/lib/services/otp";
import { getCurrentPeriod } from "@/lib/services/periods";
import { jadwalkanPengingat, jadwalUangMasuk } from "@/lib/services/scheduler";
import { kirimAntrean } from "@/lib/services/sender";
import { laukMingguKe, getShoppingWeek } from "@/lib/services/shopping";
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

beforeEach(() => resetDb(db));
afterAll(() => db.$disconnect());

describe("tagihan & paylater", () => {
  it("`bayar paylater 50k` membayar tagihan 4 Okt dari amplop Paylater (bukan tagihan 35rb di luar sistem)", async () => {
    await mulai4Okt();
    const [r] = await kirim("bayar paylater 50k", at("2026-10-04", 13));
    expect(r).toContain("Lunas");
    expect(r).toContain("4 Okt");
    const bills = await db.bill.findMany({ orderBy: { jatuhTempo: "asc" } });
    expect(bills.find((b) => b.jatuhTempo === "2026-10-04")!.status).toBe("lunas");
    expect(bills.find((b) => b.jatuhTempo === "2026-10-02")!.status).toBe("belum");
    expect(await saldo("paylater")).toBe(0);
  });

  it("`bayar paylater` tanpa nominal pakai nominal tagihan; nominal beda memperbarui tagihan", async () => {
    await mulai4Okt();
    await kirim("bayar paylater", at("2026-10-04", 13));
    const [r] = await kirim("bayar paylater 78rb", at("2026-10-30", 13));
    expect(r).toContain("udah gw sesuaikan");
    const okt = await db.bill.findFirstOrThrow({ where: { jatuhTempo: "2026-10-31" } });
    expect(okt).toMatchObject({ status: "lunas", nominal: 78000 });
  });

  it("`tagihan` menampilkan daftar + kesiapan dana", async () => {
    await mulai4Okt();
    const [r] = await kirim("tagihan", at("2026-10-04", 13));
    expect(r).toContain("Paylater Rp50.000");
    expect(r).toContain("dana cukup");
  });
});

describe("pindah antar amplop", () => {
  it("pindah dengan alasan tercatat sebagai transfer", async () => {
    await mulai4Okt();
    const [r] = await kirim("pindah 10k darurat ke makan alasan kurang lauk", at("2026-10-05"));
    expect(r).toContain("Pindah Rp10.000");
    expect(await saldo("makan")).toBe(95000);
    expect(await saldo("darurat")).toBe(10000);
    expect((await db.transfer.findFirstOrThrow()).alasan).toBe("kurang lauk");
  });

  it("tanpa alasan → bot tanya alasan dulu", async () => {
    await mulai4Okt();
    const [tanya] = await kirim("pindah 5k dari darurat ke data", at("2026-10-05"));
    expect(tanya).toContain("Alasannya apa");
    await kirim("kuota abis", at("2026-10-05"));
    expect((await db.transfer.findFirstOrThrow()).alasan).toBe("kuota abis");
  });

  it("ambil dari Tabungan kado wajib ketik YAKIN AMBIL TABUNGAN", async () => {
    await mulai4Okt();
    const [tanya] = await kirim("pindah 20k kado ke makan alasan darurat banget", at("2026-10-05"));
    expect(tanya).toContain("YAKIN AMBIL TABUNGAN");
    const [tolak] = await kirim("ok", at("2026-10-05"));
    expect(tolak).toContain("Harus ketik persis");
    expect(await db.transfer.count()).toBe(0);
    await kirim("YAKIN AMBIL TABUNGAN", at("2026-10-05"));
    expect(await saldo("kado")).toBe(95000);
  });
});

describe("mode tahan belanja", () => {
  it("`mau beli` → tunda 24 jam → ditanya ulang → `gak jadi` dihitung diselamatkan", async () => {
    await mulai4Okt();
    const [tawar] = await kirim("mau beli headset 60k", at("2026-10-05", 10));
    expect(tawar).toContain("Tahan dulu");
    expect(tawar).toContain("hari jatah makan");
    await kirim("1", at("2026-10-05", 10));
    const h = await db.holdRequest.findFirstOrThrow();
    expect(h).toMatchObject({ barang: "headset", nominal: 60000, hasil: "menunggu" });

    await jadwalkanPengingat(db, at("2026-10-06", 9));
    expect(await db.outbox.count({ where: { jenis: "tahan" } })).toBe(0);
    await jadwalkanPengingat(db, at("2026-10-06", 10, 1));
    const tanya = await db.outbox.findFirstOrThrow({ where: { jenis: "tahan" } });
    expect(tanya.isi).toContain("headset");

    const [r] = await kirim("gak jadi", at("2026-10-06", 11));
    expect(r).toContain("diselamatkan");
    expect((await db.holdRequest.findFirstOrThrow()).hasil).toBe("batal");
    expect(await db.transaction.count()).toBe(0);
  });

  it("pengeluaran Darurat di atas batas masuk mode tahan; di bawah batas langsung dicatat", async () => {
    await mulai4Okt();
    await kirim("sabun 8k", at("2026-10-05"));
    expect(await db.transaction.count()).toBe(1);
    const [r] = await kirim("laundry 30k", at("2026-10-05"));
    expect(r).toContain("Tahan dulu");
    await kirim("2", at("2026-10-05"));
    expect(await db.transaction.count()).toBe(2);
  });
});

describe("perintah lain", () => {
  it("`kemarin tempe 5k` dicatat di tanggal kemarin", async () => {
    await mulai4Okt();
    await kirim("kemarin tempe 5k", at("2026-10-06"));
    expect((await db.transaction.findFirstOrThrow()).tanggal).toBe("2026-10-05");
  });

  it("`ubah 12k` mengganti nominal catatan terakhir", async () => {
    await mulai4Okt();
    await kirim("tempe 5k", at("2026-10-05"));
    const [r] = await kirim("ubah 12k", at("2026-10-05"));
    expect(r).toContain("Rp5.000 → Rp12.000");
    expect((await db.transaction.findFirstOrThrow()).nominal).toBe(12000);
  });

  it("`target` menampilkan progres & proyeksi", async () => {
    await mulai4Okt();
    const [r] = await kirim("target", at("2026-10-05"));
    expect(r).toContain("Rp115.000 dari Rp800.000");
    expect(r).toContain("Proyeksi");
  });

  it("`belanja` & `menu`", async () => {
    await mulai4Okt();
    const [b] = await kirim("belanja", at("2026-10-05"));
    expect(b).toContain("Beras SPHP Bulog");
    expect(b).toContain("Lauk rotasi minggu ke-1");
    const [m] = await kirim("menu", at("2026-10-05"));
    expect(m).toContain("Menu hari ini");
  });

  it("`bantuan` tanpa emoji", async () => {
    const [r] = await kirim("bantuan", at("2026-10-05"));
    expect(r).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe("nomor keluarga (orang tua)", () => {
  it("dapat laporan sopan, tidak bisa mencatat", async () => {
    await mulai4Okt();
    await kirim("tempe 5k", at("2026-10-05"));
    const [lap] = await kirim("laporan", at("2026-10-05"), ORTU);
    expect(lap).toContain("Laporan Keuangan Mingguan — Abdul");
    expect(lap).toContain("Uang diterima: Rp300.000");
    expect(lap).not.toMatch(/\bgw\b|\blo\b/);

    const [menu] = await kirim("tempe 5k", at("2026-10-05"), ORTU);
    expect(menu).toContain("penerima laporan");
    expect(await db.transaction.count()).toBe(1);
  });

  it("konfirmasi uang masuk mengirim tanda terima ke keluarga", async () => {
    await mulai4Okt();
    const o = await db.outbox.findMany({ where: { jenis: "konfirmasi_uang" } });
    expect(o).toHaveLength(1);
    expect(o[0].nomor).toBe("628979936381");
    expect(o[0].isi).toContain("Rp300.000 sudah diterima Abdul");
  });
});

describe("penjadwal pengingat", () => {
  it("jam pengingat uang masuk Minggu: 09, 12, 15, 18, 21", () => {
    expect(jadwalUangMasuk("09:00")).toEqual([540, 720, 900, 1080, 1260]);
  });

  it("Minggu 09.00 → ke 2 nomor pemilik saja; berhenti setelah `masuk` dikonfirmasi", async () => {
    await jadwalkanPengingat(db, at("2026-10-04", 9, 2));
    const o = await db.outbox.findMany({ where: { jenis: "uang_masuk" } });
    expect(o.map((x) => x.nomor).sort()).toEqual(["6285163544535", "628971688893"]);
    await jadwalkanPengingat(db, at("2026-10-04", 9, 5)); // tidak dobel
    expect(await db.outbox.count({ where: { jenis: "uang_masuk" } })).toBe(2);

    await mulai4Okt();
    await jadwalkanPengingat(db, at("2026-10-04", 12, 0));
    expect(await db.outbox.count({ where: { jenis: "uang_masuk" } })).toBe(2);
  });

  it("pagi 07.00: jatah + menu + tagihan dekat; malam 21.00 hanya kalau belum catat", async () => {
    await mulai4Okt();
    await jadwalkanPengingat(db, at("2026-10-05", 7, 0));
    const pagi = await db.outbox.findFirstOrThrow({ where: { jenis: "pagi" } });
    expect(pagi.isi).toContain("Jatah makan hari ini");
    expect(pagi.isi).toContain("Menu:");

    await kirim("tempe 5k", at("2026-10-05", 12));
    await jadwalkanPengingat(db, at("2026-10-05", 21, 0));
    expect(await db.outbox.count({ where: { jenis: "malam" } })).toBe(0);
    await jadwalkanPengingat(db, at("2026-10-06", 21, 0));
    expect(await db.outbox.count({ where: { jenis: "malam" } })).toBe(2);
  });

  it("tagihan H-1 (3 Okt) dan rekap + laporan keluarga Sabtu 20.00", async () => {
    await mulai4Okt();
    await jadwalkanPengingat(db, at("2026-10-30", 9, 0)); // H-1 tagihan 31 Okt
    const t = await db.outbox.findMany({ where: { jenis: "tagihan" } });
    expect(t.length).toBe(2);
    expect(t[0].isi).toContain("besok");
    expect(t[0].isi).toContain("perkiraan");

    await jadwalkanPengingat(db, at("2026-10-10", 20, 0));
    expect(await db.outbox.count({ where: { jenis: "rekap" } })).toBe(2);
    const lap = await db.outbox.findMany({ where: { jenis: "laporan_keluarga" } });
    expect(lap.map((l) => l.nomor)).toEqual(["628979936381"]);
  });

  it("pengingat yang dimatikan tidak dikirim", async () => {
    await db.reminderSetting.update({ where: { jenis: "uang_masuk" }, data: { aktif: false } });
    await jadwalkanPengingat(db, at("2026-10-04", 9, 0));
    expect(await db.outbox.count()).toBe(0);
  });
});

describe("aturan kirim pesan proaktif", () => {
  it("jam tenang 22.00–06.00 WIB", () => {
    expect(isJamTenang(at("2026-10-05", 21, 59))).toBe(false);
    expect(isJamTenang(at("2026-10-05", 22, 0))).toBe(true);
    expect(isJamTenang(at("2026-10-06", 5, 59))).toBe(true);
    expect(isJamTenang(at("2026-10-06", 6, 0))).toBe(false);
    expect(waktuBolehKirim(at("2026-10-05", 23)).toISOString()).toBe(at("2026-10-06", 6).toISOString());
  });

  it("jam tenang: rekap ditunda ke 06.00, pengingat malam dibuang", () => {
    const now = at("2026-10-10", 22, 30);
    const r = rencanaKirim(
      [
        { id: 1, nomor: "a", jenis: "rekap", dijadwalkan: at("2026-10-10", 22, 0) },
        { id: 2, nomor: "a", jenis: "malam", dijadwalkan: at("2026-10-10", 21, 50) },
      ],
      new Map(),
      now,
    );
    expect(r.kirim).toEqual([]);
    expect(r.tunda).toEqual([{ id: 1, sampai: at("2026-10-11", 6) }]);
    expect(r.buang).toEqual([2]);
  });

  it("maksimal 1 pesan per jam per nomor, pesan bersamaan digabung", () => {
    const now = at("2026-10-04", 9, 5);
    const items = [
      { id: 1, nomor: "a", jenis: "uang_masuk", dijadwalkan: at("2026-10-04", 9) },
      { id: 2, nomor: "a", jenis: "tagihan", dijadwalkan: at("2026-10-04", 9) },
      { id: 3, nomor: "b", jenis: "tagihan", dijadwalkan: at("2026-10-04", 9) },
    ];
    const r = rencanaKirim(items, new Map([["b", at("2026-10-04", 8, 30)]]), now);
    expect(r.kirim).toEqual([{ nomor: "a", ids: [1, 2], proaktif: true }]);
    expect(r.tunda).toEqual([{ id: 3, sampai: at("2026-10-04", 9, 30) }]);
  });

  it("OTP selalu langsung terkirim walau jam tenang", () => {
    const r = rencanaKirim([{ id: 9, nomor: "a", jenis: "otp", dijadwalkan: at("2026-10-05", 23) }], new Map(), at("2026-10-05", 23, 1));
    expect(r.kirim).toEqual([{ nomor: "a", ids: [9], proaktif: false }]);
  });

  it("kirimAntrean: tidak ada pesan terkirim di jam tenang; siang hari terkirim & tercatat", async () => {
    await jadwalkanPengingat(db, at("2026-10-04", 9, 0));
    const terkirim: string[] = [];
    const send = async (n: string) => void terkirim.push(n);
    expect(await kirimAntrean(db, send, at("2026-10-04", 9, 1))).toBe(2);
    expect(terkirim.sort()).toEqual(["6285163544535", "628971688893"]);

    await db.outbox.create({ data: { nomor: "6285163544535", jenis: "rekap", isi: "x", dijadwalkan: at("2026-10-04", 23) } });
    expect(await kirimAntrean(db, send, at("2026-10-04", 23, 5))).toBe(0);
    const tunda = await db.outbox.findFirstOrThrow({ where: { jenis: "rekap" } });
    expect(tunda.dijadwalkan.toISOString()).toBe(at("2026-10-05", 6).toISOString());
  });

  it("gagal kirim → dicoba lagi nanti", async () => {
    await db.outbox.create({ data: { nomor: "6285163544535", jenis: "tagihan", isi: "x", dijadwalkan: at("2026-10-04", 10) } });
    await kirimAntrean(db, async () => { throw new Error("putus"); }, at("2026-10-04", 10, 1));
    const o = await db.outbox.findFirstOrThrow();
    expect(o).toMatchObject({ status: "antri", percobaan: 1 });
  });
});

describe("target & belanja", () => {
  it("proyeksi tabungan kado = saldo + setoran rencana sampai 15 Nov", async () => {
    await mulai4Okt();
    const g = (await getGoalProgress(db, at("2026-10-05")))!;
    expect(g.saldo).toBe(115000);
    expect(g.proyeksi).toBe(865000); // total rencana PRD
    expect(g.status).toBe("aman");
    expect(g.estimasiTercapai).toBe("2026-11-15");
    expect(g.series[0]).toMatchObject({ minggu: "2026-10-04", rencana: 115000, aktual: 115000 });
  });

  it("lauk rotasi 4 minggu & total belanja", async () => {
    expect([laukMingguKe("2026-10-04"), laukMingguKe("2026-10-11"), laukMingguKe("2026-10-25"), laukMingguKe("2026-11-01")]).toEqual([1, 2, 4, 1]);
    const w = await getShoppingWeek(db, at("2026-10-04"));
    expect(w.total).toBe(85000);
    expect(w.status).toBe("aman");
  });
});

describe("ekspor, backup, OTP", () => {
  it("Excel berisi 3 sheet dengan angka yang sama dengan service", async () => {
    await mulai4Okt();
    await kirim("tempe 5k", at("2026-10-05"));
    const buf = await buildWorkbook(db, at("2026-10-05"));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Belanja Makan", "Budget Mingguan", "Ringkasan"]);
    const budget = wb.getWorksheet("Budget Mingguan")!;
    expect(budget.getRow(2).getCell(3).value).toBe(300000);
    const ringkasan = wb.getWorksheet("Ringkasan")!;
    const baris = ringkasan.getSheetValues().find((r) => Array.isArray(r) && r[1] === "Saldo Makan") as unknown[];
    expect(baris[2]).toBe(await saldo("makan"));
    const csv = await buildTransactionsCsv(db);
    expect(csv).toContain("tempe");
  });

  it("backup menyimpan 4 salinan terakhir", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dk-backup-"));
    for (let i = 0; i < 6; i++) await backupDatabase(db, new Date(Date.UTC(2026, 9, 1 + i)), dir);
    const list = listBackups(dir);
    expect(list).toHaveLength(4);
    expect(list[0].nama).toContain("2026-10-06");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("OTP: butuh WA terhubung, kode dikirim ke pemilik, sekali pakai", async () => {
    process.env.SESSION_SECRET = "tes";
    await expect(requestLoginCode(db, at("2026-10-05"))).rejects.toMatchObject({ code: "invalid" });
    await db.waConnection.update({ where: { id: 1 }, data: { status: "terhubung" } });
    await requestLoginCode(db, at("2026-10-05"));
    const o = await db.outbox.findMany({ where: { jenis: "otp" } });
    expect(o).toHaveLength(2);
    const kode = /\*(\d{6})\*/.exec(o[0].isi)![1];
    expect(await verifyLoginCode(db, "000000" === kode ? "111111" : "000000", at("2026-10-05"))).toBe(false);
    expect(await verifyLoginCode(db, kode, at("2026-10-05", 12, 1))).toBe(true);
    expect(await verifyLoginCode(db, kode, at("2026-10-05", 12, 2))).toBe(false);
  });
});
