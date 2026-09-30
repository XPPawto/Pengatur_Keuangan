/**
 * Simulasi pesan WhatsApp tanpa WhatsApp sungguhan (untuk coba-coba / debug parser).
 * Pakai: npm run wa:sim -- 085163544535 "tempe 5k sama telur 14k"
 * Menulis ke database yang sama dengan bot & website.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { handleMessage } from "../src/lib/bot/handler";

const [nomor, ...kata] = process.argv.slice(2);
if (!nomor || kata.length === 0) {
  console.error('Pakai: npm run wa:sim -- <nomor> "<pesan>"');
  process.exit(1);
}
const db = new PrismaClient();
handleMessage(db, { nomor, text: kata.join(" "), now: new Date() })
  .then((balasan) => {
    if (balasan.length === 0) console.log("(tidak dibalas — nomor tidak terdaftar?)");
    for (const b of balasan) console.log(`\n🤖 ${b.replace(/\n/g, "\n   ")}`);
  })
  .finally(() => db.$disconnect());
