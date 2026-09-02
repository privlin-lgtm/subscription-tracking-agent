import { describe, expect, it } from "vitest";
import { parseLlmExtraction } from "@/application/extraction/extraction-schema";

describe("extraction schema", () => {
  it("parses a valid LLM payload", () => {
    const result = parseLlmExtraction(
      {
        is_subscription: true,
        is_cancellation: false,
        vendor: "Netflix",
        price: { amount: 15.49, currency: "usd" },
        billing_cycle: "monthly",
        renewal_date: "2026-10-02",
        confidence: 0.94,
      },
      new Date("2026-09-02"),
    );
    expect(result.vendor).toBe("Netflix");
    expect(result.currency).toBe("USD");
    expect(result.renewalDate?.toISOString().slice(0, 10)).toBe("2026-10-02");
  });

  it("clamps out-of-range confidence to 0-1", () => {
    const result = parseLlmExtraction(
      {
        is_subscription: true,
        is_cancellation: false,
        vendor: "Netflix",
        price: { amount: 10, currency: "USD" },
        billing_cycle: "monthly",
        renewal_date: null,
        confidence: 4,
      },
      new Date("2026-09-02"),
    );
    expect(result.confidence).toBe(1);
  });

  it("rejects implausible renewal dates", () => {
    const result = parseLlmExtraction(
      {
        is_subscription: true,
        is_cancellation: false,
        vendor: "Netflix",
        price: { amount: 10, currency: "USD" },
        billing_cycle: "monthly",
        renewal_date: "2035-01-01",
        confidence: 0.9,
      },
      new Date("2026-09-02"),
    );
    expect(result.renewalDate).toBeNull();
  });

  it("normalizes extracted currencies and leaves unknown codes uppercase for later review", () => {
    const usd = parseLlmExtraction(
      {
        is_subscription: true,
        is_cancellation: false,
        vendor: "Netflix",
        price: { amount: 15.49, currency: "usd" },
        billing_cycle: "monthly",
        renewal_date: null,
        confidence: 0.9,
      },
      new Date("2026-09-02"),
    );
    expect(usd.currency).toBe("USD");

    const unknown = parseLlmExtraction(
      {
        is_subscription: true,
        is_cancellation: false,
        vendor: "Netflix",
        price: { amount: 15.49, currency: "xyz" },
        billing_cycle: "monthly",
        renewal_date: null,
        confidence: 0.9,
      },
      new Date("2026-09-02"),
    );
    expect(unknown.currency).toBe("XYZ");
  });

  it("parses a cancellation payload that omits price and date detail", () => {
    const result = parseLlmExtraction(
      {
        is_subscription: true,
        is_cancellation: true,
        vendor: "Netflix",
        price: { amount: 0, currency: "USD" },
        billing_cycle: "unknown",
        renewal_date: null,
        confidence: 0.9,
      },
      new Date("2026-09-02"),
    );
    expect(result.isCancellation).toBe(true);
  });
});
