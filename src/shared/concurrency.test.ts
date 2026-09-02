import { describe, expect, it } from "vitest";
import { runWithConcurrency } from "@/shared/concurrency";

describe("runWithConcurrency", () => {
  it("processes every item exactly once", async () => {
    const seen: number[] = [];
    await runWithConcurrency([1, 2, 3, 4, 5], 2, async (item) => {
      seen.push(item);
    });
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it("never runs more than `limit` calls concurrently", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    await runWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 3, async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
    });
    expect(maxInFlight).toBeLessThanOrEqual(3);
  });

  it("degenerates to serial execution when limit is 1", async () => {
    const order: number[] = [];
    let inFlight = 0;
    await runWithConcurrency([1, 2, 3], 1, async (item) => {
      inFlight += 1;
      expect(inFlight).toBe(1);
      order.push(item);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
    });
    expect(order).toEqual([1, 2, 3]);
  });

  it("handles an empty list without error", async () => {
    await expect(runWithConcurrency([], 5, async () => {})).resolves.toBeUndefined();
  });

  it("caps worker count at the item count when limit exceeds it", async () => {
    let maxInFlight = 0;
    let inFlight = 0;
    await runWithConcurrency([1, 2], 10, async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
    });
    expect(maxInFlight).toBe(2);
  });

  it("propagates an error from fn", async () => {
    await expect(
      runWithConcurrency([1, 2, 3], 2, async (item) => {
        if (item === 2) {
          throw new Error("boom");
        }
      }),
    ).rejects.toThrow("boom");
  });
});
