import { describe, expect, it, vi } from "vitest";
import { GmailAuthError, GmailRateLimitError } from "@/domain/errors";
import { withGmailRetries } from "@/infrastructure/gmail/rate-limit";

describe("gmail retries", () => {
  it("retries 429 responses with backoff and then succeeds", async () => {
    const sleep = vi.fn(async () => undefined);
    let attempts = 0;
    const result = await withGmailRetries(
      async () => {
        attempts += 1;
        if (attempts < 3) {
          throw { code: 429, response: { headers: { "retry-after": "1" } } };
        }
        return "ok";
      },
      { sleep, random: () => 0, maxAttempts: 5 },
    );

    expect(result).toBe("ok");
    expect(attempts).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it("does not retry auth failures", async () => {
    await expect(
      withGmailRetries(async () => {
        throw { code: 401 };
      }),
    ).rejects.toBeInstanceOf(GmailAuthError);
  });

  it("gives up after the configured attempt budget", async () => {
    await expect(
      withGmailRetries(
        async () => {
          throw { code: 429, response: { headers: { "retry-after": "0" } } };
        },
        { sleep: async () => undefined, random: () => 0, maxAttempts: 2 },
      ),
    ).rejects.toBeInstanceOf(GmailRateLimitError);
  });
});
