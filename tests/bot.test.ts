import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { handleMessage } from "@/lib/bot/handler";
import { resetDb } from "./helpers";
import { getBalances } from "@/lib/services/envelopes";
import { getCurrentPeriod } from "@/lib/services/periods";
import { recordExpense } from "@/lib/services/transactions";
import { fromWib } from "@/lib/time";

const db = new PrismaClient();
const ABDUL = "085163544535";
const PASANGAN = "08971688893";

/** WIB: hari `tgl` pukul `jam`:00 */
const at = (tgl: string, jam = 12) => fromWib(tgl, jam);
const kirim = (text: string, now: Date, nomor = ABDUL) => handleMessage(db, { nomor, text, now });

const reset = () => resetDb(db);

/** Mulai periode Minggu 4 Okt 2026 dengan uang Rp300rb. */
async function mulaiPeriode4Okt() {
  await kirim("masuk 300", at("2026-10-04", 10));
  await kirim("ok", at("2026-10-04", 10));
}

async function saldo(kode: string) {
  const p = (await getCurrentPeriod(db))!;
  return (await getBalances(db, p.id)).find((b) => b.kode === kode)!;
}

beforeEach(reset);
afterAll(() => db.$disconnect());

describe("uang masuk", () => {
  it("masuk 300 → usulan pembagian dari seed, `ok` mengaktifkan periode", async () => {
    const [usulan] = await kirim("masuk 300", at("2026-10-04", 10));
    expect(usulan).toContain("4–10 Okt");
    expect(usulan).toContain("Makan Rp85.000 | Data Rp30.000 | Paylater Rp50.000");
    expect(usulan).toContain("Tabungan kado Rp115.000 | Darurat Rp20.000");
    expect(await getCurrentPeriod(db)).toBeNull();

    const [ok] = await kirim("ok", at("2026-10-04", 10));
    expect(ok).toContain("resmi jalan");
    const p = await getCurrentPeriod(db);
    expect(p).toMatchObject({ tanggalMulai: "2026-10-04", tanggalSelesai: "2026-10-10", pemasukan: 300000, status: "aktif" });
  });

  it("masuk 250 → Darurat dipotong duluan, Makan & Data tetap utuh", async () => {
    const [usulan] = await kirim("masuk 250", at("2026-10-11", 14));
    expect(usulan).toContain("Makan Rp85.000 | Data Rp30.000");
    expect(usulan).toContain("Darurat Rp0");
    expect(usulan).toContain("Darurat -Rp33.000");
    expect(usulan).toContain("target kado mundur");
  });

  it("`batal` saat usulan membuang periode menunggu", async () => {
    await kirim("masuk 300", at("2026-10-04", 10));
    const [r] = await kirim("batal", at("2026-10-04", 10));
    expect(r).toContain("dibatalin");
    expect(await db.period.count()).toBe(0);
  });

  it("masuk lagi di minggu yang sama = uang ekstra, default 50% kado / 50% darurat", async () => {
    await mulaiPeriode4Okt();
    const [tanya] = await kirim("masuk 40", at("2026-10-06"));
    expect(tanya).toContain("uang ekstra");
    await kirim("ok", at("2026-10-06"));
    expect((await saldo("kado")).saldo).toBe(115000 + 20000);
    expect((await saldo("darurat")).saldo).toBe(20000 + 20000);
  });

  it("periode baru: sisa Makan minggu lalu pindah ke Darurat", async () => {
    await mulaiPeriode4Okt();
    await kirim("tempe 5k", at("2026-10-05"));
    await kirim("masuk 300", at("2026-10-11", 15));
    const [ok] = await kirim("ok", at("2026-10-11", 15));
    expect(ok).toContain("Rp80.000 udah pindah ke Darurat");
    // sisa makan 80rb + sisa paket data 30rb (belum dibeli) pindah ke Darurat
    expect((await saldo("darurat")).saldo).toBe(20000 + 80000 + 30000 + 33000);
    expect((await saldo("makan")).saldo).toBe(85000);
  });
});

describe("catat pengeluaran", () => {
  it.each(["tempe 5k", "tempe 5rb", "tempe 5.000", "tempe 5000"])("%s → Rp5.000 di Makan", async (teks) => {
    await mulaiPeriode4Okt();
    await kirim(teks, at("2026-10-05"));
    const tx = await db.transaction.findMany({ include: { envelope: true } });
    expect(tx).toHaveLength(1);
    expect(tx[0]).toMatchObject({ nominal: 5000, sumber: "wa", pesanAsli: teks });
    expect(tx[0].envelope.kode).toBe("makan");
  });

  it("`tempe 5k sama telur 14k` → 2 transaksi", async () => {
    await mulaiPeriode4Okt();
    const [r] = await kirim("tempe 5k sama telur 14k", at("2026-10-05"));
    expect(await db.transaction.count()).toBe(2);
    expect(r).toContain("2 catatan masuk ke Makan (Rp19.000)");
    expect(r).toContain("Sisa makan Rp66.000 buat 6 hari");
  });

  it("kategori tidak jelas → bot tanya pilihan bernomor, bukan menebak", async () => {
    await mulaiPeriode4Okt();
    const [tanya] = await kirim("ojek 10k", at("2026-10-05"));
    expect(tanya).toContain("masuk amplop mana?");
    expect(tanya).toContain("1. Makan");
    expect(await db.transaction.count()).toBe(0);

    const [jawab] = await kirim("3", at("2026-10-05"));
    expect(jawab).toContain("ojek Rp10.000 masuk ke Darurat");
    const tx = await db.transaction.findFirstOrThrow({ include: { envelope: true } });
    expect(tx.envelope.kode).toBe("darurat");
  });

  it("jawaban `batal` pada pertanyaan kategori tidak mencatat apa pun", async () => {
    await mulaiPeriode4Okt();
    await kirim("ojek 10k", at("2026-10-05"));
    await kirim("batal", at("2026-10-05"));
    expect(await db.transaction.count()).toBe(0);
  });

  it("belum ada periode → diminta `masuk` dulu", async () => {
    const [r] = await kirim("tempe 5k", at("2026-10-04"));
    expect(r).toContain("masuk 300");
    expect(await db.transaction.count()).toBe(0);
  });

  it("angka polos dianggap ribuan dan diberi catatan", async () => {
    await mulaiPeriode4Okt();
    const [r] = await kirim("tempe 5", at("2026-10-05"));
    expect(r).toContain("dianggap ribuan");
    expect((await db.transaction.findFirstOrThrow()).nominal).toBe(5000);
  });

  it("kedua nomor terdaftar menulis ke data yang sama", async () => {
    await mulaiPeriode4Okt();
    await kirim("tempe 5k", at("2026-10-05"), ABDUL);
    await kirim("telur 14k", at("2026-10-05"), PASANGAN);
    expect(await db.transaction.count()).toBe(2);
  });

  it("peringatan sekali saat amplop turun di bawah 20%", async () => {
    await mulaiPeriode4Okt();
    const [a] = await kirim("beras 60k", at("2026-10-04", 13)); // sisa 25rb (29%)
    expect(a).not.toContain("Peringatan");
    const [b] = await kirim("telur 10k", at("2026-10-04", 14)); // sisa 15rb (<17rb)
    expect(b).toContain("Peringatan: Makan tinggal Rp15.000");
    const [c] = await kirim("tempe 2k", at("2026-10-04", 15));
    expect(c).not.toContain("Peringatan");
  });
});

describe("jatah harian", () => {
  it("sisa makan Rp61.000 dan 6 hari tersisa → jatah Rp10.100", async () => {
    await mulaiPeriode4Okt();
    await kirim("beras 24k", at("2026-10-04", 14)); // Minggu: 85 - 24 = 61
    const [sisa] = await kirim("sisa", at("2026-10-05", 7)); // Senin: 6 hari (Sen–Sab + ... termasuk hari ini)
    expect(sisa).toContain("Sisa makan Rp61.000 buat 6 hari");
    expect(sisa).toContain("Jatah hari ini Rp10.100");
  });

  it("boros hari ini → bot kasih tahu jatah besok yang baru", async () => {
    await mulaiPeriode4Okt();
    const [r] = await kirim("beras 40k", at("2026-10-04", 14)); // jatah Minggu 85rb/7 = 12.100
    expect(r).toContain("lewat Rp27.900");
    expect(r).toContain("Jatah besok jadi Rp7.500");
  });
});

describe("perintah lain", () => {
  it("`hari ini` dan `sisa`", async () => {
    await mulaiPeriode4Okt();
    await kirim("tempe 5k", at("2026-10-05", 8));
    const [h] = await kirim("hari ini", at("2026-10-05", 9));
    expect(h).toContain("tempe Rp5.000 [Makan]");
    expect(h).toContain("Total Rp5.000");
    const [s] = await kirim("sisa", at("2026-10-05", 9));
    expect(s).toContain("Makan: Rp80.000 / Rp85.000");
    expect(s).toContain("Tabungan kado (terkunci): Rp115.000");
  });

  it("`batal` minta konfirmasi lalu menghapus transaksi terakhir", async () => {
    await mulaiPeriode4Okt();
    await kirim("tempe 5k", at("2026-10-05", 8));
    await kirim("telur 14k", at("2026-10-05", 9));
    const [tanya] = await kirim("batal", at("2026-10-05", 10));
    expect(tanya).toContain("telur Rp14.000");
    expect(await db.transaction.count()).toBe(2);
    await kirim("ok", at("2026-10-05", 10));
    const sisa = await db.transaction.findMany();
    expect(sisa.map((t) => t.catatan)).toEqual(["tempe"]);
  });

  it("`nol` menghitung hari disiplin dan streak", async () => {
    await mulaiPeriode4Okt();
    await kirim("tempe 5k", at("2026-10-04", 12));
    await kirim("nol", at("2026-10-05", 20));
    const [r] = await kirim("gak jajan", at("2026-10-06", 20));
    expect(r).toContain("Streak disiplin 3 hari");
  });

});

describe("keamanan", () => {
  it("nomor tak terdaftar diabaikan tanpa balasan dan tanpa efek, dan dicatat di log", async () => {
    await mulaiPeriode4Okt();
    const r = await kirim("tempe 5k", at("2026-10-05"), "6281234567890");
    expect(r).toEqual([]);
    expect(await db.transaction.count()).toBe(0);
    const log = await db.messageLog.findMany({ where: { nomor: "6281234567890" } });
    expect(log).toHaveLength(1);
    expect(log[0].isi).toContain("diabaikan");
  });

  it("Tabungan kado terkunci: ambil tanpa kata konfirmasi ditolak", async () => {
    await mulaiPeriode4Okt();
    const coba = (konfirmasiBukaKunci?: string) =>
      recordExpense(db, { kode: "kado", nominal: 10000, sumber: "web", now: at("2026-10-05"), konfirmasiBukaKunci });
    await expect(coba()).rejects.toMatchObject({ code: "locked" });
    await expect(coba("yakin")).rejects.toMatchObject({ code: "locked" });
    expect(await db.transaction.count()).toBe(0);
    await coba("YAKIN AMBIL TABUNGAN");
    expect((await saldo("kado")).saldo).toBe(105000);
  });
});

describe("sinkron bot ↔ website", () => {
  it("usulan dari bot yang sudah dikonfirmasi di website: `ok` di WA tidak error", async () => {
    await kirim("masuk 300", at("2026-10-04", 10));
    const { confirmPeriod, getPendingPeriod } = await import("@/lib/services/periods");
    await confirmPeriod(db, (await getPendingPeriod(db))!.id, at("2026-10-04", 10));
    const [r] = await kirim("ok", at("2026-10-04", 11));
    expect(r).toContain("udah dikonfirmasi");
  });
});
