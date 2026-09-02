import type { JobLock } from "@/domain/ports";
import { prisma } from "@/infrastructure/db/prisma";

function lockKey(userId: string): bigint {
  let hash = 0n;
  for (const char of userId) {
    hash = (hash * 31n + BigInt(char.charCodeAt(0))) % 2_147_483_647n;
  }
  return hash;
}

// Postgres session-level advisory locks are tied to the specific connection that acquired
// them: pg_advisory_unlock only releases the lock if called on that same connection, and
// returns false (a silent no-op) otherwise. A bare `prisma.$queryRaw` for the lock and
// another for the unlock each borrow a connection from Prisma's pool independently, with no
// guarantee it's the same one -- so the unlock could easily be a no-op, leaking the lock
// until the original connection happens to close. `$transaction` pins every query inside its
// callback to one connection for the whole callback's duration, which is what makes the
// lock/work/unlock sequence below actually correct. (The BEGIN/COMMIT it also adds doesn't
// interact with these locks -- non-`_xact_` advisory locks are session-scoped, not
// transaction-scoped, so they survive the commit and are released only by the explicit
// pg_advisory_unlock call.) See docs/phase10-scalability-review.md.
const LOCK_TRANSACTION_TIMEOUT_MS = 5 * 60 * 1000;

export class PostgresAdvisoryLock implements JobLock {
  async withUserLock<T>(userId: string, fn: () => Promise<T>): Promise<T | null> {
    const key = lockKey(userId);
    return prisma.$transaction(
      async (tx) => {
        const acquired = await tx.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_try_advisory_lock(${key}) AS locked`;
        if (!acquired[0]?.locked) {
          return null;
        }
        try {
          return await fn();
        } finally {
          await tx.$queryRaw`SELECT pg_advisory_unlock(${key})`;
        }
      },
      { timeout: LOCK_TRANSACTION_TIMEOUT_MS },
    );
  }
}

export const systemClock = { now: () => new Date() };
