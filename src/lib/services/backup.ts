import fs from "node:fs";
import path from "node:path";
import type { Db } from "../db";

export const BACKUP_DIR = path.resolve(process.env.BACKUP_DIR ?? "./data/backups");
const SIMPAN = 4;

/** Salin database dengan aman (VACUUM INTO: konsisten walau bot sedang menulis). Simpan 4 salinan terakhir. */
export async function backupDatabase(db: Db, now = new Date(), dir = BACKUP_DIR, simpan = SIMPAN): Promise<string> {
  fs.mkdirSync(dir, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const file = path.join(dir, `dompetkos-${stamp}.db`);
  await db.$executeRawUnsafe(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const semua = listBackups(dir);
  for (const lama of semua.slice(simpan)) fs.rmSync(path.join(dir, lama.nama), { force: true });
  return file;
}

export function listBackups(dir = BACKUP_DIR) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^dompetkos-.*\.db$/.test(f))
    .map((nama) => {
      const st = fs.statSync(path.join(dir, nama));
      return { nama, ukuran: st.size, waktu: st.mtime };
    })
    .sort((a, b) => b.nama.localeCompare(a.nama));
}
