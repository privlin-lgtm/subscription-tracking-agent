import { GmailAuthError, GmailRateLimitError } from "@/domain/errors";
import { classifyGmailError, retryAfterMs } from "@/infrastructure/gmail/gmail-errors";

export type SleepFn = (ms: number) => Promise<void>;

const defaultSleep: SleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function withGmailRetries<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number;
    sleep?: SleepFn;
    random?: () => number;
  } = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 5;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const kind = classifyGmailError(error);
      if (kind === "auth") {
        throw new GmailAuthError();
      }
      if (kind === "history_expired" || kind === "other") {
        throw error;
      }
      if (attempt === maxAttempts - 1) {
        throw new GmailRateLimitError(retryAfterMs(error));
      }
      const backoff = retryAfterMs(error, 500 * 2 ** attempt);
      const jitter = Math.floor(random() * 250);
      await sleep(backoff + jitter);
    }
  }

  throw lastError;
}
