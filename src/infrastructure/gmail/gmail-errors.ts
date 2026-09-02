export type GmailErrorKind = "auth" | "rate_limit" | "history_expired" | "other";

type GoogleLikeError = {
  code?: number | string;
  status?: number;
  message?: string;
  errors?: Array<{ reason?: string }>;
  response?: {
    status?: number;
    headers?: Record<string, string | string[] | undefined>;
    data?: { error?: string; error_description?: string };
  };
};

const RATE_LIMIT_REASONS = new Set([
  "rateLimitExceeded",
  "userRateLimitExceeded",
  "quotaExceeded",
  "dailyLimitExceeded",
]);

export function googleErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  const typed = error as GoogleLikeError;
  if (typeof typed.response?.status === "number") {
    return typed.response.status;
  }
  if (typeof typed.status === "number") {
    return typed.status;
  }
  if (typeof typed.code === "number") {
    return typed.code;
  }
  if (typeof typed.code === "string" && /^\d+$/.test(typed.code)) {
    return Number(typed.code);
  }
  return undefined;
}

export function gmailErrorReason(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  const typed = error as GoogleLikeError;
  return typed.errors?.[0]?.reason ?? typed.response?.data?.error;
}

export function classifyGmailError(error: unknown): GmailErrorKind {
  const status = googleErrorStatus(error);
  const reason = gmailErrorReason(error);
  const message = error instanceof Error ? error.message : "";

  if (reason === "invalid_grant" || message.includes("invalid_grant") || status === 401) {
    return "auth";
  }
  if (status === 403 && reason === "insufficientPermissions") {
    return "auth";
  }
  if (status === 404) {
    return "history_expired";
  }
  if (status === 429 || (status === 403 && reason && RATE_LIMIT_REASONS.has(reason))) {
    return "rate_limit";
  }
  return "other";
}

export function retryAfterMs(error: unknown, fallback = 1000): number {
  if (!error || typeof error !== "object") {
    return fallback;
  }
  const headers = (error as GoogleLikeError).response?.headers ?? {};
  const raw = headers["retry-after"] ?? headers["Retry-After"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) {
    return fallback;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const date = Date.parse(value);
  if (!Number.isNaN(date)) {
    return Math.max(0, date - Date.now());
  }
  return fallback;
}
