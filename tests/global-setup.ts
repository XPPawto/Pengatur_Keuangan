import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Database SQLite sementara untuk tes integrasi (tidak menyentuh data asli). */
export default function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dompetkos-test-"));
  const file = path.join(dir, "test.db");
  process.env.DATABASE_URL = `file:${file}`;
  process.env.OWNER_WA_NUMBERS = "6285163544535,628971688893";
  execSync("npx prisma db push --skip-generate --accept-data-loss", {
    cwd: path.resolve(import.meta.dirname, ".."),
    env: { ...process.env, DATABASE_URL: `file:${file}` },
    stdio: "pipe",
  });
  return () => fs.rmSync(dir, { recursive: true, force: true });
}
