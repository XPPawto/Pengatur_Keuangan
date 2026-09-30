import { hashPassword } from "../src/lib/auth/password";

const pw = process.argv[2];
if (!pw || pw.length < 8) {
  console.error("Pakai: npm run set-password <password-baru-min-8-karakter>");
  process.exit(1);
}
console.log("Salin baris ini ke file .env (ganti APP_PASSWORD_HASH yang lama):\n");
console.log(`APP_PASSWORD_HASH="${hashPassword(pw)}"`);
