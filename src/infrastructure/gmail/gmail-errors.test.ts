import { describe, expect, it } from "vitest";
import { classifyGmailError, retryAfterMs } from "@/infrastructure/gmail/gmail-errors";

describe("gmail error classification", () => {
  it("treats invalid_grant and 401 as auth failures", () => {
    expect(classifyGmailError({ code: 401 })).toBe("auth");
    expect(classifyGmailError({ response: { data: { error: "invalid_grant" } } })).toBe("auth");
    expect(classifyGmailError(new Error("invalid_grant: token revoked"))).toBe("auth");
  });

  it("treats history 404 as an expired checkpoint", () => {
    expect(classifyGmailError({ code: 404 })).toBe("history_expired");
  });

  it("treats 429 and quota reasons as rate limits", () => {
    expect(classifyGmailError({ code: 429 })).toBe("rate_limit");
    expect(classifyGmailError({ status: 403, errors: [{ reason: "userRateLimitExceeded" }] })).toBe("rate_limit");
  });

  it("reads Retry-After in seconds", () => {
    expect(retryAfterMs({ response: { headers: { "retry-after": "8" } } })).toBe(8000);
  });

  it("classifies remaining auth and unknown errors", () => {
    expect(classifyGmailError({ status: 403, errors: [{ reason: "insufficientPermissions" }] })).toBe("auth");
    expect(classifyGmailError({ code: "429" })).toBe("rate_limit");
    expect(classifyGmailError("nope")).toBe("other");
    expect(retryAfterMs("nope", 250)).toBe(250);
    expect(retryAfterMs({ response: { headers: { "Retry-After": ["2"] } } })).toBe(2000);
  });
});
