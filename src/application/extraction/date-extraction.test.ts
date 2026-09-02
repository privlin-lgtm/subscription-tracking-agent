import { describe, expect, it } from "vitest";
import { parseLlmExtraction } from "@/application/extraction/extraction-schema";

const NOW = new Date("2026-09-15T00:00:00Z");

function payload(renewalDate: string | null) {
  return {
    is_subscription: true,
    is_cancellation: false,
    vendor: "Netflix",
    price: { amount: 15.49, currency: "USD" },
    billing_cycle: "monthly" as const,
    renewal_date: renewalDate,
    confidence: 0.9,
  };
}

describe("date extraction", () => {
  it("keeps an ISO date within the plausible renewal window", () => {
    const result = parseLlmExtraction(payload("2026-10-01"), NOW);
    expect(result.renewalDate?.toISOString().slice(0, 10)).toBe("2026-10-01");
  });

  it("accepts a recent past date (late-arriving receipt)", () => {
    const result = parseLlmExtraction(payload("2026-08-20"), NOW);
    expect(result.renewalDate?.toISOString().slice(0, 10)).toBe("2026-08-20");
  });

  it("drops dates more than 45 days in the past", () => {
    const result = parseLlmExtraction(payload("2026-07-01"), NOW);
    expect(result.renewalDate).toBeNull();
  });

  it("drops dates more than 5 years in the future", () => {
    const result = parseLlmExtraction(payload("2032-01-01"), NOW);
    expect(result.renewalDate).toBeNull();
  });

  it("treats unparseable strings as missing", () => {
    const result = parseLlmExtraction(payload("next Tuesday"), NOW);
    expect(result.renewalDate).toBeNull();
  });

  it("treats a null renewal date as missing", () => {
    const result = parseLlmExtraction(payload(null), NOW);
    expect(result.renewalDate).toBeNull();
  });
});
