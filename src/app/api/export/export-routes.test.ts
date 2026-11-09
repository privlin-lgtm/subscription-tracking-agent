import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInMemoryPersistence } from "@/application/subscriptions/in-memory-subscriptions";
import { SubscriptionService } from "@/application/subscriptions/subscription.service";
import { parseIcs } from "@/test/ics-parser";

const authMock = vi.fn();
const { subscriptions, audit } = createInMemoryPersistence();
const subscriptionService = new SubscriptionService(subscriptions, audit);

vi.mock("@/infrastructure/auth/auth", () => ({ auth: authMock }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@/infrastructure/composition", () => ({ app: { subscriptionService } }));

const icsRoute = await import("@/app/api/export/renewals.ics/route");
const csvRoute = await import("@/app/api/export/subscriptions.csv/route");

const NOW = new Date("2026-11-09T12:00:00.000Z");

function signInAs(userId: string | null) {
  authMock.mockResolvedValue(userId ? { user: { id: userId } } : null);
}

function icsRequest(query = "") {
  return new Request(`http://localhost/api/export/renewals.ics${query}`);
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  subscriptions.records.clear();
  await subscriptionService.create("user_a", {
    vendor: "Netflix",
    priceAmount: 15.99,
    currency: "USD",
    billingCycle: "monthly",
    nextRenewalDate: "2026-11-15",
  });
  await subscriptionService.create("user_a", {
    vendor: "Adobe",
    priceAmount: 599.88,
    currency: "EUR",
    billingCycle: "annual",
    nextRenewalDate: "2027-03-01",
  });
  const canceled = await subscriptionService.create("user_a", {
    vendor: "Hulu",
    priceAmount: 7.99,
    currency: "USD",
    billingCycle: "monthly",
    nextRenewalDate: "2026-11-20",
  });
  await subscriptionService.cancel("user_a", canceled.id);
  await subscriptionService.create("user_b", {
    vendor: "Spotify",
    priceAmount: 9.99,
    currency: "USD",
    billingCycle: "monthly",
    nextRenewalDate: "2026-11-16",
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/export/renewals.ics", () => {
  it("returns 401 and no calendar data when signed out", async () => {
    signInAs(null);
    const response = await icsRoute.GET(icsRequest());
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns only the signed-in user's active renewals as a parseable calendar", async () => {
    signInAs("user_a");
    const response = await icsRoute.GET(icsRequest());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="subscription-renewals.ics"');
    expect(response.headers.get("cache-control")).toBe("no-store");

    const body = await response.text();
    const calendar = parseIcs(body);
    // Default window is 90 days from 9 November 2026: Netflix on 15 Nov, 15 Dec and 15 Jan.
    expect(calendar.events.map((event) => [event["DTSTART;VALUE=DATE"], event.SUMMARY])).toEqual([
      ["20261115", "Netflix renews (15.99 USD)"],
      ["20261215", "Netflix renews (15.99 USD)"],
      ["20270115", "Netflix renews (15.99 USD)"],
    ]);
    expect(calendar.events.every((event) => event.DTSTAMP === "20261109T120000Z")).toBe(true);
    expect(body).not.toContain("Spotify");
    expect(body).not.toContain("Hulu");
  });

  it("scopes by user: another user gets their own renewals, not user_a's", async () => {
    signInAs("user_b");
    const body = await (await icsRoute.GET(icsRequest("?days=30"))).text();
    expect(parseIcs(body).events.map((event) => event.SUMMARY)).toEqual(["Spotify renews (9.99 USD)"]);
    expect(body).not.toContain("Netflix");
    expect(body).not.toContain("Adobe");
  });

  it("honours the days window", async () => {
    signInAs("user_a");
    const wide = parseIcs(await (await icsRoute.GET(icsRequest("?days=365"))).text());
    expect(wide.events.filter((event) => event.SUMMARY.startsWith("Adobe"))).toHaveLength(1);
    expect(wide.events.filter((event) => event.SUMMARY.startsWith("Netflix"))).toHaveLength(12);

    const narrow = parseIcs(await (await icsRoute.GET(icsRequest("?days=1"))).text());
    expect(narrow.events).toEqual([]);
  });

  it.each(["0", "366", "abc", "1.5", "-3", ""])("rejects days=%j with a 400", async (days) => {
    signInAs("user_a");
    const response = await icsRoute.GET(icsRequest(`?days=${days}`));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "VALIDATION" });
  });
});

describe("GET /api/export/subscriptions.csv", () => {
  it("returns 401 and no rows when signed out", async () => {
    signInAs(null);
    const response = await csvRoute.GET();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns the signed-in user's subscriptions, including canceled ones, as a download", async () => {
    signInAs("user_a");
    const response = await csvRoute.GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="subscriptions.csv"');
    expect(response.headers.get("cache-control")).toBe("no-store");

    // Read the bytes so the BOM is kept (Response.text() strips it).
    const body = new TextDecoder("utf-8", { ignoreBOM: true }).decode(await response.arrayBuffer());
    expect(body.charCodeAt(0)).toBe(0xfeff);
    const lines = body.slice(1).trimEnd().split("\r\n");
    expect(lines[0]).toBe("Vendor,Status,Price,Currency,Billing cycle,Next renewal,First tracked,Last updated");
    expect(lines.slice(1).map((line) => line.split(",").slice(0, 6).join(","))).toEqual([
      "Adobe,ACTIVE,599.88,EUR,ANNUAL,2027-03-01",
      "Hulu,CANCELED,7.99,USD,MONTHLY,2026-11-20",
      "Netflix,ACTIVE,15.99,USD,MONTHLY,2026-11-15",
    ]);
    expect(body).not.toContain("Spotify");
  });

  it("scopes by user", async () => {
    signInAs("user_b");
    const body = await (await csvRoute.GET()).text();
    expect(body).toContain("Spotify,ACTIVE,9.99,USD,MONTHLY,2026-11-16");
    expect(body).not.toContain("Netflix");
    expect(body).not.toContain("Adobe");
    expect(body).not.toContain("Hulu");
  });
});
