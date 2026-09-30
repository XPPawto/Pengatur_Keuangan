import type { PrismaClient } from "@prisma/client";
import { normalizePhone, ownerNumbers } from "./whitelist";
import { PENGINGAT } from "./services/scheduler";

/** Data awal dari PRD (bagian "Data awal"). Aman dijalankan berulang: amplop/rencana di-upsert, sisanya hanya diisi kalau kosong. */
const AMPLOP = [
  { kode: "makan", nama: "Makan", jenis: "daily", defaultNominal: 85000, urutanPotong: null, terkunci: false, urutanTampil: 1 },
  { kode: "data", nama: "Paket data", jenis: "fixed", defaultNominal: 30000, urutanPotong: null, terkunci: false, urutanTampil: 2 },
  { kode: "paylater", nama: "Paylater", jenis: "sinking", defaultNominal: 27000, urutanPotong: 3, terkunci: false, urutanTampil: 3 },
  { kode: "kado", nama: "Tabungan kado", jenis: "goal", defaultNominal: 125000, urutanPotong: 2, terkunci: true, urutanTampil: 4 },
  { kode: "darurat", nama: "Darurat & kebutuhan kos", jenis: "remainder", defaultNominal: 33000, urutanPotong: 1, terkunci: false, urutanTampil: 5 },
] as const;

type Baris = [makan: number, data: number, paylater: number, kado: number, darurat: number];
const RENCANA: [string, Baris][] = [
  ["2026-10-04", [85000, 30000, 50000, 115000, 20000]],
  ["2026-10-11", [85000, 30000, 27000, 125000, 33000]],
  ["2026-10-18", [85000, 30000, 27000, 125000, 33000]],
  ["2026-10-25", [85000, 30000, 27000, 125000, 33000]],
  ["2026-11-01", [85000, 30000, 20000, 125000, 40000]],
  ["2026-11-08", [85000, 30000, 20000, 125000, 40000]],
  ["2026-11-15", [85000, 30000, 20000, 125000, 40000]],
  ["2026-11-22", [85000, 30000, 20000, 0, 165000]],
  ["2026-11-29", [85000, 30000, 0, 0, 185000]],
];
const KODE_URUT = ["makan", "data", "paylater", "kado", "darurat"] as const;

const BELANJA = [
  { nama: "Beras SPHP Bulog", jumlah: 2, satuan: "kg", hargaSatuan: 12500, kataKunci: ["beras", "nasi"] },
  { nama: "Telur", jumlah: 0.5, satuan: "kg", hargaSatuan: 28000, kataKunci: ["telur", "telor"] },
  { nama: "Mie instan", jumlah: 1, satuan: "paket isi 3", hargaSatuan: 10000, kataKunci: ["mie", "mi", "indomie", "mie instan"] },
  { nama: "Tempe", jumlah: 2, satuan: "papan", hargaSatuan: 5000, kataKunci: ["tempe"] },
  { nama: "Tahu", jumlah: 1, satuan: "bungkus", hargaSatuan: 5000, kataKunci: ["tahu"] },
  { nama: "Bumbu nasi goreng sachet", jumlah: 2, satuan: "sachet", hargaSatuan: 2500, kataKunci: ["bumbu", "nasgor", "bumbu nasi goreng"] },
  { nama: "Minyak goreng (dicicil)", jumlah: 0.25, satuan: "liter", hargaSatuan: 16000, kataKunci: ["minyak"] },
  { nama: "Garam/kecap/bawang/cabai (dicicil)", jumlah: 1, satuan: "paket", hargaSatuan: 3000, kataKunci: ["garam", "kecap", "bawang", "cabai", "cabe"] },
  { nama: "Lauk rotasi", jumlah: 1, satuan: "paket", hargaSatuan: 9000, kataKunci: ["teri", "ikan asin", "ayam", "sarden", "lauk", "ikan"] },
  { nama: "Galon/air isi ulang", jumlah: 0, satuan: "galon", hargaSatuan: 6000, kataKunci: ["galon", "air"] },
];

const MENU: [number, string, string][] = [
  [0, "pagi", "Nasi goreng telur"], [0, "siang", "Nasi + orek tempe"], [0, "malam", "Mie goreng + telur ceplok"],
  [1, "pagi", "Nasi + telur dadar"], [1, "siang", "Nasi + tahu kecap"], [1, "malam", "Nasi + lauk rotasi"],
  [2, "pagi", "Nasi goreng"], [2, "siang", "Nasi + tempe goreng"], [2, "malam", "Mie rebus + telur"],
  [3, "pagi", "Nasi + telur balado"], [3, "siang", "Nasi + orek tempe"], [3, "malam", "Nasi + lauk rotasi"],
  [4, "pagi", "Nasi goreng telur"], [4, "siang", "Nasi + tahu goreng kecap"], [4, "malam", "Mie goreng"],
  [5, "pagi", "Nasi + telur ceplok"], [5, "siang", "Nasi + lauk rotasi"], [5, "malam", "Nasi + tempe tahu bacem"],
  [6, "pagi", "Nasi goreng tempe"], [6, "siang", "Nasi + telur dadar"], [6, "malam", "Nasi + sisa lauk"],
];
const WAKTU_URUT: Record<string, number> = { pagi: 0, siang: 1, malam: 2 };

const LAUK = [
  { mingguKe: 1, nama: "Teri / ikan asin", jumlah: "±100 g", estimasi: 9000 },
  { mingguKe: 2, nama: "Ayam", jumlah: "¼ kg", estimasi: 9000 },
  { mingguKe: 3, nama: "Sarden kaleng kecil", jumlah: "1 kaleng", estimasi: 9000 },
  { mingguKe: 4, nama: "Telur tambahan", jumlah: "¼ kg", estimasi: 7000 },
];

function familyNumbers(env: NodeJS.ProcessEnv): string[] {
  return (env.FAMILY_WA_NUMBERS ?? "").split(",").map((n) => normalizePhone(n.trim())).filter(Boolean);
}

export async function seedDatabase(db: PrismaClient, env: NodeJS.ProcessEnv = process.env) {
  for (const e of AMPLOP) {
    await db.envelope.upsert({ where: { kode: e.kode }, update: {}, create: { ...e } });
  }
  const envs = await db.envelope.findMany();
  const idOf = (kode: string) => envs.find((e) => e.kode === kode)!.id;

  for (const [tanggalMulai, nominal] of RENCANA) {
    for (let i = 0; i < KODE_URUT.length; i++) {
      await db.allocationPlan.upsert({
        where: { tanggalMulai_envelopeId: { tanggalMulai, envelopeId: idOf(KODE_URUT[i]) } },
        update: {},
        create: { tanggalMulai, envelopeId: idOf(KODE_URUT[i]), nominal: nominal[i] },
      });
    }
  }

  if ((await db.bill.count()) === 0) {
    await db.bill.createMany({
      data: [
        { nama: "Paylater", nominal: 35000, jatuhTempo: "2026-10-02", envelopeId: null, catatan: "Dibayar dari sisa uang minggu berjalan (di luar sistem)" },
        { nama: "Paylater", nominal: 50000, jatuhTempo: "2026-10-04", envelopeId: idOf("paylater"), catatan: "Dari amplop Paylater periode 4 Okt" },
        { nama: "Paylater", nominal: 80000, jatuhTempo: "2026-10-31", tanggalPasti: false, envelopeId: idOf("paylater"), catatan: "±Rp80.000, tanggal pasti diisi Abdul. Sinking fund 11–25 Okt" },
        { nama: "Paylater", nominal: 80000, jatuhTempo: "2026-11-29", tanggalPasti: false, envelopeId: idOf("paylater"), catatan: "±Rp80.000, wajib lunas sebelum 30 Nov. Sinking fund 1–22 Nov" },
      ],
    });
  }

  if ((await db.goal.count()) === 0) {
    await db.goal.create({
      data: { nama: "Kado ulang tahun + anniversary 1 tahun", targetMin: 800000, targetIdeal: 900000, tenggat: "2026-11-20", envelopeId: idOf("kado") },
    });
  }

  if ((await db.shoppingItem.count()) === 0) {
    await db.shoppingItem.createMany({
      data: BELANJA.map((b, i) => ({ ...b, kataKunci: JSON.stringify(b.kataKunci), urutan: i })),
    });
  }

  const owners = ownerNumbers(env);
  const nomor = owners.length ? owners : ["6285163544535", "628971688893"].map(normalizePhone);
  for (const n of nomor) {
    await db.allowedNumber.upsert({ where: { nomor: n }, update: {}, create: { nomor: n, label: `Nomor ${n.slice(-4)}` } });
  }

  for (const n of familyNumbers(env)) {
    await db.allowedNumber.upsert({
      where: { nomor: n },
      update: {},
      create: { nomor: n, label: "Orang tua", peran: "keluarga", terimaPengingat: false, terimaLaporan: true, terimaKonfirmasiUang: true },
    });
  }

  for (const p of PENGINGAT) {
    await db.reminderSetting.upsert({ where: { jenis: p.jenis }, update: {}, create: { jenis: p.jenis, jam: p.jam, aktif: true } });
  }

  if ((await db.menuItem.count()) === 0) {
    await db.menuItem.createMany({ data: MENU.map(([hari, waktu, menu]) => ({ hari, waktu, menu, urutan: WAKTU_URUT[waktu] })) });
  }
  for (const l of LAUK) await db.laukRotasi.upsert({ where: { mingguKe: l.mingguKe }, update: {}, create: l });

  await db.waConnection.upsert({ where: { id: 1 }, update: {}, create: { id: 1, status: "terputus" } });
}
