/**
 * Setup sekali jalan: buat .env (kalau belum ada) dengan SESSION_SECRET acak dan password awal acak,
 * lalu siapkan database + data awal.
 */
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { hashPassword } from "../src/lib/auth/password";

const root = path.resolve(__dirname, "..");
const envPath = path.join(root, ".env");

fs.mkdirSync(path.join(root, "data"), { recursive: true });

if (fs.existsSync(envPath)) {
  console.log(".env sudah ada, dilewati (password tidak diubah).");
} else {
  const password = randomBytes(9).toString("base64url");
  let env = fs.readFileSync(path.join(root, ".env.example"), "utf8");
  env = env.replace(/^SESSION_SECRET=.*$/m, `SESSION_SECRET="${randomBytes(32).toString("hex")}"`);
  env = env.replace(/^APP_PASSWORD_HASH=.*$/m, `APP_PASSWORD_HASH="${hashPassword(password)}"`);
  fs.writeFileSync(envPath, env, { mode: 0o600 });
  console.log(`.env dibuat. Password login awal kamu: ${password}`);
  console.log("Simpan sekarang. Ganti kapan saja dengan `npm run set-password <password-baru>`.\n");
}

execSync("npx prisma db push --skip-generate", { cwd: root, stdio: "inherit" });
execSync("npx tsx prisma/seed.ts", { cwd: root, stdio: "inherit" });
console.log("\nSelesai. Jalankan `npm run dev`, lalu buka http://localhost:3000");
