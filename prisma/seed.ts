import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { seedDatabase } from "../src/lib/seed";

const db = new PrismaClient();
seedDatabase(db)
  .then(() => console.log("Seed selesai."))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
