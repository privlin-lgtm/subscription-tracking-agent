import { describe, expect, it } from "vitest";
import { normalizeCurrency, tryNormalizeCurrency } from "@/domain/value-objects/currency";
import { ValidationError } from "@/domain/errors";

describe("currency extraction", () => {
  it("normalizes common ISO 4217 codes from mixed case", () => {
    expect(normalizeCurrency("usd")).toBe("USD");
    expect(normalizeCurrency(" eur ")).toBe("EUR");
    expect(normalizeCurrency("GBP")).toBe("GBP");
    expect(normalizeCurrency("jpy")).toBe("JPY");
  });

  it("rejects symbols and unknown codes", () => {
    expect(() => normalizeCurrency("$")).toThrow(ValidationError);
    expect(() => normalizeCurrency("USDT")).toThrow(ValidationError);
    expect(tryNormalizeCurrency("$")).toBeNull();
    expect(tryNormalizeCurrency("")).toBeNull();
    expect(tryNormalizeCurrency(null)).toBeNull();
  });

  it("accepts zero-decimal and three-decimal currencies used in receipts", () => {
    expect(tryNormalizeCurrency("KRW")).toBe("KRW");
    expect(tryNormalizeCurrency("BHD")).toBe("BHD");
  });
});
