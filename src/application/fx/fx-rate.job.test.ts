import { describe, expect, it } from "vitest";
import { FxRateJob } from "@/application/fx/fx-rate.job";
import { InMemoryCurrencyUsage, InMemoryExchangeRates } from "@/application/fx/in-memory-fx";
import { FakeFxRateProvider } from "@/infrastructure/fx/fake-fx-rate.provider";

const NOW = new Date("2026-11-09T05:30:00Z");

function build(inUse: string[], providerRates: Record<string, number>) {
  const provider = new FakeFxRateProvider(providerRates, "2026-11-09");
  const rates = new InMemoryExchangeRates();
  const job = new FxRateJob(provider, rates, new InMemoryCurrencyUsage(inUse), { now: () => NOW }, "ILS");
  return { provider, rates, job };
}

describe("FxRateJob (fake provider, no network)", () => {
  it("fetches rates for the currencies in use plus the display options, and stores them", async () => {
    const { provider, rates, job } = build(["usd", "ILS", "SEK"], { USD: 0.31, EUR: 0.28, SEK: 2.9 });

    const result = await job.run();

    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.base).toBe("ILS");
    // The base is never requested against itself; codes are normalised and de-duplicated.
    expect(provider.calls[0]?.quotes).toEqual(["AUD", "CAD", "CHF", "EUR", "GBP", "JPY", "SEK", "USD"]);
    expect(result.stored).toBe(3);
    expect(result.missing).toEqual(["AUD", "CAD", "CHF", "GBP", "JPY"]);
    expect(await rates.listByBase("ILS")).toEqual(
      expect.arrayContaining([
        { base: "ILS", quote: "USD", rate: 0.31, rateDate: "2026-11-09", source: "fake" },
        { base: "ILS", quote: "SEK", rate: 2.9, rateDate: "2026-11-09", source: "fake" },
      ]),
    );
    expect(rates.lastFetchedAt).toEqual(NOW);
  });

  it("sends the provider currency codes only", async () => {
    const { provider, job } = build(["USD"], { USD: 0.31 });
    await job.run();
    const sent = provider.calls.flatMap((call) => [call.base, ...call.quotes]);
    expect(sent.every((value) => /^[A-Z]{3}$/.test(value))).toBe(true);
  });

  it("drops codes that are not ISO 4217 before calling the provider", async () => {
    const { provider, job } = build(["USD", "BTC", "???", ""], { USD: 0.31 });
    await job.run();
    expect(provider.calls[0]?.quotes).not.toContain("BTC");
    expect(provider.calls[0]?.quotes).not.toContain("???");
  });

  it("overwrites yesterday's rate with today's", async () => {
    const { rates, job } = build(["USD"], { USD: 0.31 });
    await rates.saveRates([{ base: "ILS", quote: "USD", rate: 0.3, rateDate: "2026-11-08", source: "fake" }], NOW);
    await job.run();
    const stored = await rates.listByBase("ILS");
    expect(stored.filter((row) => row.quote === "USD")).toEqual([
      { base: "ILS", quote: "USD", rate: 0.31, rateDate: "2026-11-09", source: "fake" },
    ]);
  });

  it("refuses to store bad rows from the provider", async () => {
    const { provider, rates, job } = build(["USD"], {});
    provider.extraRows = [
      { base: "ILS", quote: "USD", rate: 0, rateDate: "2026-11-09", source: "fake" },
      { base: "ILS", quote: "EUR", rate: Number.NaN, rateDate: "2026-11-09", source: "fake" },
      { base: "ILS", quote: "GBP", rate: 0.23, rateDate: "yesterday", source: "fake" },
      { base: "ILS", quote: "CHF", rate: 0.25, rateDate: "2026-13-45", source: "fake" },
      { base: "EUR", quote: "CAD", rate: 1.5, rateDate: "2026-11-09", source: "fake" },
      { base: "ILS", quote: "NOK", rate: 3.1, rateDate: "2026-11-09", source: "fake" },
      { base: "ILS", quote: "JPY", rate: 49.7, rateDate: "2026-11-09", source: "fake" },
    ];

    const result = await job.run();

    // Only the JPY row is for a requested pair with a positive rate and a real date.
    expect((await rates.listByBase("ILS")).map((row) => row.quote)).toEqual(["JPY"]);
    expect(result.stored).toBe(1);
    expect(result.missing).toContain("USD");
  });

  it("leaves the stored rates untouched when the provider fails", async () => {
    const { provider, rates, job } = build(["USD"], { USD: 0.31 });
    await rates.saveRates([{ base: "ILS", quote: "USD", rate: 0.3, rateDate: "2026-11-08", source: "fake" }], NOW);
    provider.failWith = new Error("provider down");

    await expect(job.run()).rejects.toThrow("provider down");
    expect(await rates.listByBase("ILS")).toEqual([
      { base: "ILS", quote: "USD", rate: 0.3, rateDate: "2026-11-08", source: "fake" },
    ]);
  });
});
