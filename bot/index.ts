import "dotenv/config";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { BaileysDriver } from "../src/lib/whatsapp/baileys";
import { WaManager } from "../src/lib/whatsapp/manager";
import { ownerNumbers } from "../src/lib/whitelist";

process.env.TZ = "Asia/Jakarta";

async function main() {
  if (ownerNumbers().length === 0) {
    console.error("OWNER_WA_NUMBERS kosong di .env. Bot tidak akan menerima pesan dari siapa pun.");
  }
  const db = new PrismaClient();
  const sessionDir = path.resolve(process.env.WA_SESSION_DIR ?? "./data/wa-session");
  const manager = new WaManager(db, new BaileysDriver(sessionDir));
  await manager.init();
  manager.startPolling();
  console.log(`[bot] jalan. Nomor penerima: ${ownerNumbers().join(", ")}. Sambungkan WhatsApp dari halaman /whatsapp di website.`);

  const stop = async () => {
    manager.stopPolling();
    await db.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
