import { describe, expect, it } from "vitest";
import { Money, majorToMinorUnits } from "@/domain/value-objects/money";

describe("Money", () => {
  it("stores USD as integer cents", () => {
    const money = Money.fromMajor(15.49, "usd");
    expect(money.amountCents).toBe(1549);
    expect(money.currency).toBe("USD");
  });

  it("rejects floating minor units", () => {
    expect(() => new Money(10.5, "USD")).toThrow(/integer/);
  });

  it("does not treat different currencies as equal", () => {
    expect(new Money(1000, "USD").approximatelyEquals(new Money(1000, "EUR"))).toBe(false);
  });

  it("allows a small price tolerance in the same currency", () => {
    expect(new Money(1000, "USD").approximatelyEquals(new Money(1040, "USD"))).toBe(true);
    expect(new Money(1000, "USD").approximatelyEquals(new Money(1200, "USD"))).toBe(false);
  });

  it("uses 1 minor unit for JPY", () => {
    expect(majorToMinorUnits(1200, "JPY")).toBe(1200);
  });
});
