import { describe, expect, it, vi } from "vitest";
import { FrankfurterRateProvider } from "@/infrastructure/fx/frankfurter.provider";

// Real shape of GET https://api.frankfurter.dev/v2/rates?base=ILS (sampled 2026-11-09).
const SAMPLE = [
  { date: "2026-11-09", base: "ILS", quote: "USD", rate: 0.31408 },
  { date: "2026-11-10", base: "ILS", quote: "EUR", rate: 0.28081 },
  { date: "2026-11-10", base: "ILS", quote: "GBP", rate: 0.23423 },
  { date: "2026-11-10", base: "ILS", quote: "JPY", rate: 49.692 },
];

function stubFetch(body: unknown, status = 200) {
  return vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
    async () => new Response(JSON.stringify(body), { status }),
  );
}

describe("FrankfurterRateProvider (stubbed fetch, no network)", () => {
  it("maps the v2 response to rates, keeping each row's own date", async () => {
    const fetchImpl = stubFetch(SAMPLE);
    const provider = new FrankfurterRateProvider("https://api.frankfurter.dev", fetchImpl);

    const rates = await provider.fetchLatest("ILS", ["USD", "EUR"]);

    expect(rates).toEqual([
      { base: "ILS", quote: "USD", rate: 0.31408, rateDate: "2026-11-09", source: "frankfurter" },
      { base: "ILS", quote: "EUR", rate: 0.28081, rateDate: "2026-11-10", source: "frankfurter" },
    ]);
  });

  it("sends nothing but the base currency code", async () => {
    const fetchImpl = stubFetch(SAMPLE);
    const provider = new FrankfurterRateProvider("https://api.frankfurter.dev/", fetchImpl);

    await provider.fetchLatest("ILS", ["USD", "EUR"]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.frankfurter.dev/v2/rates?base=ILS");
    expect(init?.method).toBeUndefined();
    expect(init?.body).toBeUndefined();
    expect(init?.headers).toEqual({ Accept: "application/json" });
  });

  it("returns fewer rows when a requested currency is not covered", async () => {
    const provider = new FrankfurterRateProvider("https://api.frankfurter.dev", stubFetch(SAMPLE));
    const rates = await provider.fetchLatest("ILS", ["USD", "XTS"]);
    expect(rates.map((row) => row.quote)).toEqual(["USD"]);
  });

  it("throws on an HTTP error", async () => {
    const provider = new FrankfurterRateProvider(
      "https://api.frankfurter.dev",
      stubFetch({ status: 422, message: "invalid currency: ABC" }, 422),
    );
    await expect(provider.fetchLatest("ABC", ["USD"])).rejects.toThrow("HTTP 422");
  });

  it("throws on an unexpected response shape instead of guessing", async () => {
    const oldV1Shape = { amount: 1, base: "ILS", date: "2026-11-09", rates: { USD: 0.31408 } };
    const provider = new FrankfurterRateProvider("https://api.frankfurter.dev", stubFetch(oldV1Shape));
    await expect(provider.fetchLatest("ILS", ["USD"])).rejects.toThrow("unexpected response shape");
  });
});
