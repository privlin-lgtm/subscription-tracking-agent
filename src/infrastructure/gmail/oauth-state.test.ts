import { describe, expect, it } from "vitest";
import { ValidationError } from "@/domain/errors";
import { signOAuthState, verifyOAuthState } from "@/infrastructure/gmail/oauth-state";

const SECRET = "test-secret-value-for-hmac";

describe("oauth state", () => {
  it("round-trips a signed state for the same user", () => {
    const now = 1_000_000;
    const state = signOAuthState("user_1", SECRET, now, "nonce-1");
    const payload = verifyOAuthState(state, "user_1", SECRET, now + 1000);
    expect(payload.userId).toBe("user_1");
    expect(payload.nonce).toBe("nonce-1");
  });

  it("rejects a state meant for another user", () => {
    const state = signOAuthState("user_1", SECRET, 1_000_000, "nonce-1");
    expect(() => verifyOAuthState(state, "user_2", SECRET, 1_000_000)).toThrow(ValidationError);
  });

  it("rejects expired and tampered state", () => {
    const now = 1_000_000;
    const state = signOAuthState("user_1", SECRET, now, "nonce-1");
    expect(() => verifyOAuthState(state, "user_1", SECRET, now + 11 * 60 * 1000)).toThrow(/expired/);
    expect(() => verifyOAuthState(`${state}x`, "user_1", SECRET, now)).toThrow(ValidationError);
  });
});
