import { describe, expect, it } from "vitest";
import { Money, formatMinorAmount, majorToMinorUnits } from "@/domain/value-objects/money";

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
    expect(new Money(1000, "USD").equals(new Money(1000, "USD"))).toBe(true);
    expect(new Money(1000, "USD").equals(new Money(1000, "EUR"))).toBe(false);
  });

  it("rejects a non-positive major amount", () => {
    expect(() => Money.fromMajor(0, "USD")).toThrow(/positive/);
    expect(() => Money.fromMajor(-1, "USD")).toThrow(/positive/);
  });

  it("allows a small price tolerance in the same currency", () => {
    expect(new Money(1000, "USD").approximatelyEquals(new Money(1040, "USD"))).toBe(true);
    expect(new Money(1000, "USD").approximatelyEquals(new Money(1200, "USD"))).toBe(false);
  });

  it("uses 1 minor unit for JPY", () => {
    expect(majorToMinorUnits(1200, "JPY")).toBe(1200);
  });

  it("formats minor units with each currency's own decimals", () => {
    expect(formatMinorAmount(1599, "USD")).toBe("15.99");
    expect(formatMinorAmount(1000, "usd")).toBe("10.00");
    expect(formatMinorAmount(1500, "JPY")).toBe("1500");
    expect(formatMinorAmount(1234, "KWD")).toBe("1.234");
  });
});
