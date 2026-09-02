import { describe, expect, it } from "vitest";
import { calibrateConfidence } from "@/application/extraction/confidence-calibration";
import type { ExtractionResult } from "@/domain/ports";

const base: ExtractionResult = {
  isSubscription: true,
  vendor: "Netflix",
  priceAmount: 15.49,
  currency: "USD",
  billingCycle: "monthly",
  renewalDate: new Date("2026-10-02"),
  confidence: 0.8,
};

describe("confidence calibration", () => {
  it("boosts known billing domains", () => {
    const result = calibrateConfidence(base, { sender: "info@netflix.com", knownVendorMatch: true }, 0.85);
    expect(result.confidence).toBeGreaterThan(0.8);
    expect(result.reviewReason).toBeNull();
  });

  it("caps confidence below auto-apply when price is missing", () => {
    const result = calibrateConfidence(
      { ...base, priceAmount: 0 },
      { sender: "unknown@example.com", knownVendorMatch: false },
      0.85,
    );
    expect(result.confidence).toBeLessThan(0.85);
    expect(result.reviewReason).toContain("missing_or_invalid_price");
  });
});
