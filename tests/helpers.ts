import type { PrismaClient } from "@prisma/client";
import { seedDatabase } from "@/lib/seed";

const TABEL = [
  "aiCall", "aiChat", "aiMemori", "kataKategori",
  "activityLog", "reconciliation", "debtPayment", "debt", "extraIncome",
  "pendingAction", "messageLog", "outbox", "loginCode", "shoppingCheck", "holdRequest", "dailyLog",
  "transfer", "transaction", "allocation", "period", "bill", "goal", "shoppingItem", "menuItem", "laukRotasi",
  "allocationPlan", "allowedNumber", "reminderSetting", "setting", "waCommand", "waConnectionLog", "waConnection", "envelope",
] as const;

/** Kosongkan semua tabel lalu isi data awal. */
export async function resetDb(db: PrismaClient) {
  for (const t of TABEL) await (db[t] as unknown as { deleteMany(): Promise<unknown> }).deleteMany();
  await seedDatabase(db, { ...process.env, OWNER_WA_NUMBERS: "6285163544535,628971688893", FAMILY_WA_NUMBERS: "628979936381" });
}
