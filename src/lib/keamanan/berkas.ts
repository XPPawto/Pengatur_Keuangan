import fs from "node:fs";
import path from "node:path";

/**
 * Server dipakai bersama orang lain: semua data DompetKos (database, backup, sesi WhatsApp, konfigurasi
 * Claude, .env) hanya boleh dibaca user Linux yang menjalankan aplikasi.
 * - umask 077: file/folder baru otomatis 600/700
 * - file/folder lama yang terlanjur longgar dirapatkan (folder 700, file 600)
 * Mengembalikan daftar peringatan (mis. file milik user lain yang tidak bisa diubah).
 */
export function kunciBerkas(akar = process.cwd()): string[] {
  const peringatan: string[] = [];
  try {
    process.umask(0o077);
  } catch {
    /* tidak didukung (mis. Windows) */
  }
  const sasaran = new Set<string>();
  // folder yang berisi (atau sama dengan) folder proyek tidak pernah dirapatkan rekursif: bisa merusak node_modules
  const folderAman = (d: string) => d !== path.parse(d).root && !(akar + path.sep).startsWith(path.resolve(d) + path.sep);
  const db = process.env.DATABASE_URL ?? "";
  if (db.startsWith("file:")) {
    const file = path.resolve(akar, "prisma", db.slice(5));
    if (folderAman(path.dirname(file))) sasaran.add(path.dirname(file));
    else for (const f of [file, `${file}-journal`, `${file}-wal`]) sasaran.add(f);
  }
  for (const d of [process.env.WA_SESSION_DIR ?? "./data/wa-session", process.env.BACKUP_DIR ?? "./data/backups", process.env.AI_CONFIG_DIR ?? "./data/claude-config"]) {
    const abs = path.resolve(akar, d);
    if (folderAman(abs)) sasaran.add(abs);
  }
  sasaran.add(path.resolve(akar, ".env"));

  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  const rapatkan = (p: string, dalam = 0) => {
    let st: fs.Stats;
    try {
      st = fs.lstatSync(p);
    } catch {
      return; // belum ada
    }
    if (st.isSymbolicLink()) return;
    if (uid !== null && st.uid !== uid) {
      peringatan.push(`${path.relative(akar, p) || p} milik user lain, izinnya tidak bisa dirapatkan.`);
      return;
    }
    const mode = st.isDirectory() ? 0o700 : 0o600;
    if ((st.mode & 0o777) !== mode) {
      try {
        fs.chmodSync(p, mode);
      } catch (e) {
        peringatan.push(`Gagal mengubah izin ${p}: ${e instanceof Error ? e.message : e}`);
      }
    }
    if (st.isDirectory() && dalam < 6) {
      for (const f of fs.readdirSync(p)) rapatkan(path.join(p, f), dalam + 1);
    }
  };
  for (const s of sasaran) rapatkan(s);
  return peringatan;
}

/** Izin yang masih terlalu longgar (bisa dibaca user lain) — untuk halaman Kesehatan sistem. */
export function berkasTerbuka(akar = process.cwd()): string[] {
  const out: string[] = [];
  const cek = [path.resolve(akar, ".env"), path.resolve(akar, "data")];
  for (const p of cek) {
    try {
      const st = fs.statSync(p);
      if (st.mode & 0o077) out.push(path.relative(akar, p) || p);
    } catch {
      /* belum ada */
    }
  }
  return out;
}
