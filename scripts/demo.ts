/**
 * Isi database DEMO dengan 4 minggu data contoh (untuk mencoba tampilan tanpa data asli).
 * Pakai: DATABASE_URL="file:../data/demo.db" npm run demo
 * Menolak jalan kalau DATABASE_URL menunjuk ke database utama.
 */
import "dotenv/config";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { handleMessage } from "../src/lib/bot/handler";
import { seedDatabase } from "../src/lib/seed";
import { addDays, fromWib, sundayOnOrBefore, wibDate } from "../src/lib/time";

const url = process.env.DATABASE_URL ?? "";
if (!url.includes("demo")) {
  console.error('Demi keamanan, jalankan dengan DATABASE_URL yang mengandung "demo", mis. file:../data/demo.db');
  process.exit(1);
}
// Database demo selalu dibuat dari nol: hapus file demo lama (hanya file bernama *demo*), lalu buat skema.
const file = path.resolve("prisma", url.replace(/^file:/, ""));
if (!path.basename(file).includes("demo")) process.exit(1);
fs.rmSync(file, { force: true });
execSync("npx prisma db push --skip-generate", { stdio: "inherit" });

const db = new PrismaClient();
const owner = (process.env.OWNER_WA_NUMBERS ?? "6285163544535").split(",")[0];
const kirim = (text: string, tgl: string, jam = 12) => handleMessage(db, { nomor: owner, text, now: fromWib(tgl, jam) });

const MAKAN = ["tempe 5k", "telur 14k", "tahu 5k", "mie 3,5k", "bumbu nasgor 2,5k", "beras 25k", "kecap 3k", "galon 6k", "sarden 9k", "minyak 4k"];

async function main() {
  await seedDatabase(db, { ...process.env, FAMILY_WA_NUMBERS: process.env.FAMILY_WA_NUMBERS ?? "628979936381" });
  const hariIni = wibDate(new Date());
  const mulai = addDays(sundayOnOrBefore(hariIni), -21);
  let seed = 7;
  const acak = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);

  for (let w = 0; w < 4; w++) {
    const minggu = addDays(mulai, w * 7);
    await kirim(`masuk ${w === 2 ? 270 : 300}`, minggu, 10);
    await kirim("ok", minggu, 10);
    if (w === 0) await kirim("kuota 30k", minggu, 11);
    for (let d = 0; d < 7; d++) {
      const tgl = addDays(minggu, d);
      if (tgl > hariIni) break;
      if (acak() < 0.15) {
        await kirim("nol", tgl, 20);
        continue;
      }
      const n = 1 + Math.floor(acak() * 2);
      for (let i = 0; i < n; i++) await kirim(MAKAN[Math.floor(acak() * MAKAN.length)], tgl, 8 + i * 5);
      if (acak() < 0.12) await kirim("sabun 8k", tgl, 19);
    }
    if (w === 1) await kirim("kuota 30k", minggu, 11);
  }
  await kirim("mau beli headset 60k", hariIni, 9);
  await kirim("1", hariIni, 9);
  console.log("Data demo siap.");
}

main().finally(() => db.$disconnect());
