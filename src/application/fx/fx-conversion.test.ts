import { describe, expect, it } from "vitest";
import type { FxRate } from "@/domain/ports";
import { convertTotals, rateAgeDays } from "@/application/fx/fx-conversion";

const NOW = new Date("2026-11-09T12:00:00Z");

function rate(quote: string, value: number, rateDate = "2026-11-09", base = "ILS"): FxRate {
  return { base, quote, rate: value, rateDate, source: "fake" };
}

function convert(
  totals: Array<{ currency: string; totalCents: number }>,
  rates: FxRate[],
  displayCurrency = "ILS",
  overrides: { now?: Date; maxRateAgeDays?: number } = {},
) {
  return convertTotals({
    totals,
    displayCurrency,
    rates,
    baseCurrency: "ILS",
    now: overrides.now ?? NOW,
    maxRateAgeDays: overrides.maxRateAgeDays ?? 7,
  });
}

describe("convertTotals: math", () => {
  it("converts a foreign subtotal into the base display currency and adds the native one untouched", () => {
    // 1 ILS = 0.25 USD, so 10.00 USD = 40.00 ILS. Plus 59.90 ILS native.
    const result = convert(
      [
        { currency: "ILS", totalCents: 5990 },
        { currency: "USD", totalCents: 1000 },
      ],
      [rate("USD", 0.25)],
    );
    expect(result).toEqual({
      ok: true,
      converted: { currency: "ILS", totalCents: 9990, rateDate: "2026-11-09", source: "fake", approximate: true },
    });
  });

  it("converts into a non-base display currency through the base (cross rate)", () => {
    // 1 ILS = 0.25 USD = 0.20 EUR. 100.00 ILS -> 25.00 USD; 20.00 EUR -> 100 ILS -> 25.00 USD.
    const result = convert(
      [
        { currency: "EUR", totalCents: 2000 },
        { currency: "ILS", totalCents: 10000 },
        { currency: "USD", totalCents: 500 },
      ],
      [rate("USD", 0.25), rate("EUR", 0.2)],
      "USD",
    );
    expect(result.ok && result.converted.totalCents).toBe(2500 + 2500 + 500);
    expect(result.ok && result.converted.currency).toBe("USD");
  });

  it("respects currencies whose minor unit is not 1/100 (JPY has none)", () => {
    // 1 ILS = 50 JPY. 1500 JPY (stored as 1500 minor units) = 30.00 ILS = 3000 agorot.
    const toIls = convert([{ currency: "JPY", totalCents: 1500 }, { currency: "ILS", totalCents: 100 }], [rate("JPY", 50)]);
    expect(toIls.ok && toIls.converted.totalCents).toBe(3100);

    // And the other way: 30.00 ILS = 1500 JPY, an integer number of yen.
    const toJpy = convert([{ currency: "ILS", totalCents: 3000 }, { currency: "JPY", totalCents: 10 }], [rate("JPY", 50)], "JPY");
    expect(toJpy.ok && toJpy.converted.totalCents).toBe(1510);
  });
});

describe("convertTotals: rounding", () => {
  it("rounds each converted subtotal half-up to the display currency's minor unit", () => {
    // 1 ILS = 0.8 USD -> 1 USD = 1.25 ILS. 0.02 USD = 0.025 ILS -> 2.5 agorot -> rounds up to 3.
    const up = convert([{ currency: "USD", totalCents: 2 }, { currency: "ILS", totalCents: 0 }], [rate("USD", 0.8)]);
    expect(up.ok && up.converted.totalCents).toBe(3);

    // 0.01 USD = 1.25 agorot -> rounds down to 1.
    const down = convert([{ currency: "USD", totalCents: 1 }, { currency: "ILS", totalCents: 0 }], [rate("USD", 0.8)]);
    expect(down.ok && down.converted.totalCents).toBe(1);
  });

  it("rounds per currency and then sums, and always returns an integer", () => {
    // 1 USD = 1.25 ILS, 1 EUR = 1.25 ILS. Each 0.01 -> 1.25 agorot -> 1. Sum is 2, not round(2.5) = 3.
    const result = convert(
      [
        { currency: "EUR", totalCents: 1 },
        { currency: "USD", totalCents: 1 },
      ],
      [rate("USD", 0.8), rate("EUR", 0.8)],
    );
    expect(result.ok && result.converted.totalCents).toBe(2);

    const realistic = convert(
      [
        { currency: "ILS", totalCents: 5990 },
        { currency: "USD", totalCents: 1549 },
      ],
      [rate("USD", 0.31408)],
    );
    // 15.49 / 0.31408 = 49.3186... ILS -> 4932 agorot, + 5990.
    expect(realistic.ok && realistic.converted.totalCents).toBe(10922);
    expect(realistic.ok && Number.isInteger(realistic.converted.totalCents)).toBe(true);
  });
});

describe("convertTotals: missing and stale rates", () => {
  const totals = [
    { currency: "ILS", totalCents: 5990 },
    { currency: "USD", totalCents: 1000 },
    { currency: "EUR", totalCents: 1000 },
  ];

  it("returns no total at all when any needed rate is missing", () => {
    expect(convert(totals, [rate("USD", 0.25)])).toEqual({ ok: false, reason: "RATE_MISSING", currencies: ["EUR"] });
    expect(convert(totals, [])).toEqual({ ok: false, reason: "RATE_MISSING", currencies: ["EUR", "USD"] });
  });

  it("needs a rate for the display currency itself when it is not the base", () => {
    const result = convert([{ currency: "ILS", totalCents: 100 }, { currency: "USD", totalCents: 100 }], [rate("USD", 0.25)], "GBP");
    expect(result).toEqual({ ok: false, reason: "RATE_MISSING", currencies: ["GBP"] });
  });

  it("ignores unusable stored rows: wrong base, zero, negative or non-finite rates", () => {
    const bad = [rate("USD", 0.25, "2026-11-09", "EUR"), rate("EUR", 0), rate("EUR", -1), rate("EUR", Number.NaN)];
    expect(convert(totals, bad)).toEqual({ ok: false, reason: "RATE_MISSING", currencies: ["EUR", "USD"] });
  });

  it("returns no total when a needed rate is older than the limit", () => {
    const result = convert(totals, [rate("USD", 0.25, "2026-11-01"), rate("EUR", 0.2)]);
    expect(result).toEqual({ ok: false, reason: "RATE_STALE", currencies: ["USD"] });
  });

  it("accepts a rate exactly at the age limit and rejects one a day past it", () => {
    const atLimit = convert(totals, [rate("USD", 0.25, "2026-11-02"), rate("EUR", 0.2, "2026-11-02")]);
    expect(atLimit.ok).toBe(true);
    const pastLimit = convert(totals, [rate("USD", 0.25, "2026-11-02"), rate("EUR", 0.2, "2026-11-02")], "ILS", {
      now: new Date("2026-11-10T00:00:01Z"),
    });
    expect(pastLimit.ok).toBe(false);
  });

  it("does not let a stale rate for an unrelated currency block the total", () => {
    const result = convert(
      [{ currency: "ILS", totalCents: 100 }, { currency: "USD", totalCents: 100 }],
      [rate("USD", 0.25), rate("EUR", 0.2, "2020-01-01")],
    );
    expect(result.ok).toBe(true);
  });

  it("reports the oldest rate date used, and tolerates a date one day ahead of UTC", () => {
    const result = convert(totals, [rate("USD", 0.25, "2026-11-06"), rate("EUR", 0.2, "2026-11-10")]);
    expect(result.ok && result.converted.rateDate).toBe("2026-11-06");
  });
});

describe("rateAgeDays", () => {
  it("counts whole UTC calendar days", () => {
    expect(rateAgeDays("2026-11-09", new Date("2026-11-09T23:59:59Z"))).toBe(0);
    expect(rateAgeDays("2026-11-08", new Date("2026-11-09T00:00:00Z"))).toBe(1);
    expect(rateAgeDays("2026-11-10", new Date("2026-11-09T12:00:00Z"))).toBe(-1);
  });
});
