import { PrismaClient, type Prisma } from "@prisma/client";

const g = globalThis as unknown as { __prisma?: PrismaClient };

export const prisma: PrismaClient = g.__prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") g.__prisma = prisma;

/** Bisa PrismaClient biasa atau klien di dalam $transaction. */
export type Db = PrismaClient | Prisma.TransactionClient;
