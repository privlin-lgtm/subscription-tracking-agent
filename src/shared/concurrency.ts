/**
 * Runs `fn` over `items` with at most `limit` calls in flight at once. Each of `limit` workers
 * pulls the next item off a shared index as soon as it finishes the previous one, so slower
 * items don't leave other workers idle waiting on a fixed batch boundary.
 */
export async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (index < items.length) {
      const item = items[index];
      index += 1;
      await fn(item);
    }
  });
  await Promise.all(workers);
}
