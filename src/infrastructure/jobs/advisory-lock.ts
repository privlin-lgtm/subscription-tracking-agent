import type { JobLock } from "@/domain/ports";
import { prisma } from "@/infrastructure/db/prisma";

function lockKey(userId: string): bigint {
  let hash = 0n;
  for (const char of userId) {
    hash = (hash * 31n + BigInt(char.charCodeAt(0))) % 2_147_483_647n;
  }
  return hash;
}

export class PostgresAdvisoryLock implements JobLock {
  async withUserLock<T>(userId: string, fn: () => Promise<T>): Promise<T | null> {
    const key = lockKey(userId);
    const acquired = await prisma.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_try_advisory_lock(${key}) AS locked`;
    if (!acquired[0]?.locked) {
      return null;
    }
    try {
      return await fn();
    } finally {
      await prisma.$queryRaw`SELECT pg_advisory_unlock(${key})`;
    }
  }
}

export const systemClock = { now: () => new Date() };
