import { beforeEach, describe, expect, it, vi } from "vitest";
import { SubscriptionStatus } from "@prisma/client";
import type { FxRate } from "@/domain/ports";
import { InMemoryExchangeRates, InMemoryUserPreferences } from "@/application/fx/in-memory-fx";
import { createInMemoryPersistence } from "@/application/subscriptions/in-memory-subscriptions";
import { SubscriptionService } from "@/application/subscriptions/subscription.service";

const NOW = new Date("2026-11-09T12:00:00Z");
const state = vi.hoisted(() => ({ app: {} as { subscriptionService?: unknown }, userId: "user_a" as string | null }));

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@/infrastructure/auth/auth", () => ({
  auth: vi.fn(async () => (state.userId ? { user: { id: state.userId } } : null)),
}));
vi.mock("@/infrastructure/composition", () => ({ app: state.app }));

const { GET } = await import("@/app/api/reports/spend/route");

type Cycle = "WEEKLY" | "MONTHLY" | "ANNUAL" | "CUSTOM";

async function seed(rates: FxRate[], currencies: Array<[string, number, Cycle?]>, displayCurrency?: string) {
  const { subscriptions, audit } = createInMemoryPersistence();
  const preferences = new InMemoryUserPreferences();
  if (displayCurrency) {
    await preferences.setDisplayCurrency("user_a", displayCurrency);
  }
  for (const [priceCurrency, priceAmountCents, billingCycle = "MONTHLY"] of currencies) {
    await subscriptions.create({
      userId: "user_a",
      vendorNormalized: `Vendor ${priceCurrency}`,
      vendorRaw: `Vendor ${priceCurrency}`,
      status: SubscriptionStatus.ACTIVE,
      priceAmountCents,
      priceCurrency,
      billingCycle,
      nextRenewalDate: null,
      lastSeenEmailId: null,
      confidenceScore: 1,
    });
  }
  state.app.subscriptionService = new SubscriptionService(subscriptions, audit, {
    rates: new InMemoryExchangeRates(rates),
    displayCurrencyFor: async (userId) => (await preferences.getDisplayCurrency(userId)) ?? "ILS",
    clock: { now: () => NOW },
    baseCurrency: "ILS",
    maxRateAgeDays: 7,
  });
}

const usdRate = (rateDate: string): FxRate => ({ base: "ILS", quote: "USD", rate: 0.25, rateDate, source: "frankfurter" });

describe("GET /api/reports/spend", () => {
  beforeEach(() => {
    state.userId = "user_a";
  });

  it("returns 401 without a session", async () => {
    state.userId = null;
    const response = await GET();
    expect(response.status).toBe(401);
  });

  it("returns byCurrency plus a converted total in the default display currency", async () => {
    await seed([usdRate("2026-11-09")], [["ILS", 5990], ["USD", 1000]]);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      summary: {
        period: "monthly",
        excludedCount: 0,
        mixed: true,
        byCurrency: [
          { currency: "ILS", totalCents: 5990, subscriptionCount: 1 },
          { currency: "USD", totalCents: 1000, subscriptionCount: 1 },
        ],
        converted: {
          currency: "ILS",
          totalCents: 9990,
          rateDate: "2026-11-09",
          source: "frankfurter",
          approximate: true,
        },
      },
    });
  });

  it("converts into the user's own display currency when they have picked one", async () => {
    await seed([usdRate("2026-11-09")], [["ILS", 6000], ["USD", 1000]], "USD");
    const body = (await (await GET()).json()) as { summary: { converted?: { currency: string; totalCents: number } } };
    // 60.00 ILS * 0.25 = 15.00 USD, plus 10.00 USD native.
    expect(body.summary.converted).toMatchObject({ currency: "USD", totalCents: 2500 });
  });

  it("omits the converted total and keeps MIXED_CURRENCY_NO_FX when the rate is stale", async () => {
    await seed([usdRate("2026-10-01")], [["ILS", 5990], ["USD", 1000]]);
    expect(await (await GET()).json()).toEqual({
      summary: {
        period: "monthly",
        excludedCount: 0,
        mixed: true,
        warning: "MIXED_CURRENCY_NO_FX",
        fxUnavailable: "RATE_STALE",
        byCurrency: [
          { currency: "ILS", totalCents: 5990, subscriptionCount: 1 },
          { currency: "USD", totalCents: 1000, subscriptionCount: 1 },
        ],
      },
    });
  });

  it("omits the converted total and keeps MIXED_CURRENCY_NO_FX when no rate is stored", async () => {
    await seed([], [["ILS", 5990], ["USD", 1000]]);
    const body = (await (await GET()).json()) as { summary: Record<string, unknown> };
    expect(body.summary.warning).toBe("MIXED_CURRENCY_NO_FX");
    expect(body.summary.fxUnavailable).toBe("RATE_MISSING");
    expect(body.summary).not.toHaveProperty("converted");
  });

  it("keeps the single-currency shape unchanged", async () => {
    await seed([usdRate("2026-11-09")], [["USD", 1000], ["USD", 549]]);
    expect(await (await GET()).json()).toEqual({
      summary: {
        period: "monthly",
        excludedCount: 0,
        mixed: false,
        currency: "USD",
        totalCents: 1549,
        subscriptionCount: 2,
      },
    });
  });

  it("returns monthly figures: annual and weekly plans are converted, custom ones are left out and counted", async () => {
    await seed(
      [usdRate("2026-11-09")],
      [
        ["ILS", 5000, "MONTHLY"],
        ["ILS", 12000, "ANNUAL"], // 10.00 a month
        ["ILS", 300, "WEEKLY"], // 13.00 a month
        ["USD", 12000, "ANNUAL"], // 10.00 USD a month = 40.00 ILS
        ["USD", 99900, "CUSTOM"], // left out
      ],
    );

    expect(await (await GET()).json()).toEqual({
      summary: {
        period: "monthly",
        excludedCount: 1,
        mixed: true,
        byCurrency: [
          { currency: "ILS", totalCents: 7300, subscriptionCount: 3 },
          { currency: "USD", totalCents: 1000, subscriptionCount: 1 },
        ],
        converted: {
          currency: "ILS",
          totalCents: 11300,
          rateDate: "2026-11-09",
          source: "frankfurter",
          approximate: true,
        },
      },
    });
  });

  it("reports excludedCount on the single-currency shape", async () => {
    await seed([], [["USD", 1000], ["USD", 2400, "ANNUAL"], ["USD", 700, "CUSTOM"]]);
    expect(await (await GET()).json()).toEqual({
      summary: {
        period: "monthly",
        excludedCount: 1,
        mixed: false,
        currency: "USD",
        totalCents: 1200,
        subscriptionCount: 2,
      },
    });
  });
});
