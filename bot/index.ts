import "dotenv/config";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { BaileysDriver } from "../src/lib/whatsapp/baileys";
import { WaManager } from "../src/lib/whatsapp/manager";
import { ownerNumbers } from "../src/lib/whitelist";
import { jadwalkanPengingat, dalamJendela } from "../src/lib/services/scheduler";
import { kirimAntrean } from "../src/lib/services/sender";
import { backupDatabase, listBackups } from "../src/lib/services/backup";
import { alarmKesehatan } from "../src/lib/services/health";
import { cekPulihAI } from "../src/lib/ai/panggil";
import { wibWeekday } from "../src/lib/time";

process.env.TZ = "Asia/Jakarta";

const log = (m: string) => console.log(`[bot] ${m}`);

async function main() {
  if (ownerNumbers().length === 0) {
    console.error("OWNER_WA_NUMBERS kosong di .env. Bot tidak akan menerima pesan dari siapa pun.");
  }
  const db = new PrismaClient();
  const sessionDir = path.resolve(process.env.WA_SESSION_DIR ?? "./data/wa-session");
  const manager = new WaManager(db, new BaileysDriver(sessionDir), { jedaBalasMs: 400 });
  await manager.init();
  manager.startPolling();
  log(`jalan. Nomor pemilik: ${ownerNumbers().join(", ")}. Sambungkan WhatsApp dari halaman /whatsapp di website.`);

  // Penjadwal pengingat (tiap menit) — semua jadwal pakai WIB. Tidak tumpang-tindih kalau satu putaran
  // lama (mis. menunggu evaluasi dari asisten AI).
  let jadwalJalan = false;
  const tickJadwal = async () => {
    if (jadwalJalan) return;
    jadwalJalan = true;
    try {
      await putaranJadwal();
    } finally {
      jadwalJalan = false;
    }
  };
  const putaranJadwal = async () => {
    const now = new Date();
    try {
      const n = await jadwalkanPengingat(db, now);
      if (n) log(`${n} pengingat masuk antrean`);
    } catch (e) {
      log(`penjadwal error: ${e}`);
    }
    // Backup otomatis Sabtu 23.30, simpan 4 salinan terakhir.
    if (wibWeekday(now) === 6 && dalamJendela(now, "23:30")) {
      const terakhir = listBackups()[0];
      if (!terakhir || now.getTime() - terakhir.waktu.getTime() > 20 * 3600_000) {
        try {
          log(`backup: ${await backupDatabase(db, now)}`);
        } catch (e) {
          log(`backup gagal: ${e}`);
        }
      }
    }
  };
  void tickJadwal();
  const jadwalTimer = setInterval(() => void tickJadwal(), 60_000);

  // Alarm kesehatan tiap 30 menit: backup terlambat, antrean macet, disk hampir penuh.
  const tickSehat = async () => {
    try {
      const n = await alarmKesehatan(db, new Date());
      if (n) log(`${n} peringatan sistem masuk antrean`);
    } catch (e) {
      log(`cek kesehatan error: ${e}`);
    }
    try {
      if (await cekPulihAI(db, new Date())) log("asisten AI aktif lagi");
    } catch (e) {
      log(`cek AI error: ${e}`);
    }
  };
  const sehatTimer = setInterval(() => void tickSehat(), 30 * 60_000);

  // Pengirim antrean (tiap 5 detik, hanya kalau WhatsApp terhubung).
  let sibuk = false;
  const kirimTimer = setInterval(async () => {
    if (sibuk || !manager.isConnected()) return;
    sibuk = true;
    try {
      const n = await kirimAntrean(db, (nomor, text) => manager.send(nomor, text), new Date());
      if (n) log(`${n} pesan terjadwal terkirim`);
    } catch (e) {
      log(`pengirim error: ${e}`);
    } finally {
      sibuk = false;
    }
  }, 5000);

  const stop = async () => {
    clearInterval(jadwalTimer);
    clearInterval(sehatTimer);
    clearInterval(kirimTimer);
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
