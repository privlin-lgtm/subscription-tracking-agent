import { EventType, SubscriptionStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { createInMemoryPersistence } from "@/application/subscriptions/in-memory-subscriptions";
import {
  legacyVendorDisplayName,
  planVendorRecase,
  recaseVendorNames,
  type VendorRecaseRow,
} from "@/application/subscriptions/vendor-recase";

const CATALOGUE = ["Netflix", "GitHub", "Spotify"];

const row = (id: string, vendorRaw: string, vendorNormalized: string, userId = "user_1"): VendorRecaseRow => ({
  id,
  userId,
  vendorRaw,
  vendorNormalized,
});

describe("vendor recase plan", () => {
  it("restores the casing of names the old rule title-cased", () => {
    const changes = planVendorRecase(
      [row("a", "XPlace", "Xplace"), row("b", "WalkFit", "Walkfit"), row("c", "Apple TV", "Apple Tv")],
      CATALOGUE,
    );
    expect(changes.map((change) => [change.from, change.to])).toEqual([
      ["Xplace", "XPlace"],
      ["Walkfit", "WalkFit"],
      ["Apple Tv", "Apple TV"],
    ]);
  });

  it("leaves names that the new rule would still title-case", () => {
    expect(planVendorRecase([row("a", "netflix.com", "Netflix Com"), row("b", "ACME CORP", "Acme Corp")], [])).toEqual([]);
  });

  it("never touches a catalogue name", () => {
    // Stored "Spotify" is also what the old rule made from "SpotiFY"; it is a catalogue name, so it stays.
    expect(planVendorRecase([row("a", "SpotiFY", "Spotify"), row("b", "GITHUB", "GitHub")], CATALOGUE)).toEqual([]);
  });

  it("never touches a name that did not come from the old rule (edited in review, or a held email sender)", () => {
    expect(
      planVendorRecase(
        [row("a", "XPlace", "X Place Ltd"), row("b", "Netflix <info@netflix.com>", "Netflix <info@netflix.com>")],
        CATALOGUE,
      ),
    ).toEqual([]);
  });

  it("is a no-op the second time", () => {
    expect(planVendorRecase([row("a", "XPlace", "XPlace")], CATALOGUE)).toEqual([]);
  });

  it("reproduces the old rule", () => {
    expect(legacyVendorDisplayName("XPlace")).toBe("Xplace");
    expect(legacyVendorDisplayName("NETFLIX.COM")).toBe("Netflix Com");
  });
});

describe("vendor recase run", () => {
  async function seed() {
    const { subscriptions, audit } = createInMemoryPersistence();
    const created = [];
    for (const [vendorRaw, vendorNormalized] of [
      ["XPlace", "Xplace"],
      ["Netflix", "Netflix"],
    ]) {
      created.push(
        await subscriptions.create({
          userId: "user_1",
          vendorNormalized,
          vendorRaw,
          status: SubscriptionStatus.ACTIVE,
          priceAmountCents: 1000,
          priceCurrency: "ILS",
          billingCycle: "MONTHLY",
          nextRenewalDate: null,
          lastSeenEmailId: null,
          confidenceScore: 1,
        }),
      );
    }
    return { subscriptions, audit, created };
  }

  it("writes nothing on a dry run but reports the changes", async () => {
    const { subscriptions, audit, created } = await seed();

    const changes = await recaseVendorNames(subscriptions, created, CATALOGUE, { dryRun: true });

    expect(changes).toEqual([{ id: created[0].id, userId: "user_1", vendorRaw: "XPlace", from: "Xplace", to: "XPlace" }]);
    expect(subscriptions.records.get(created[0].id)?.vendorNormalized).toBe("Xplace");
    expect(subscriptions.events).toEqual([]);
    expect(await audit.listByUser("user_1")).toEqual([]);
  });

  it("renames through applyWrite, leaving an UPDATED event and an audit entry", async () => {
    const { subscriptions, audit, created } = await seed();

    await recaseVendorNames(subscriptions, created, CATALOGUE, { dryRun: false });

    expect(subscriptions.records.get(created[0].id)?.vendorNormalized).toBe("XPlace");
    expect(subscriptions.records.get(created[1].id)?.vendorNormalized).toBe("Netflix");
    expect(subscriptions.events).toEqual([
      expect.objectContaining({
        subscriptionId: created[0].id,
        eventType: EventType.UPDATED,
        payload: { vendorNormalized: "XPlace", previousVendorNormalized: "Xplace", source: "vendor-recase" },
      }),
    ]);
    expect(await audit.listByUser("user_1")).toEqual([
      expect.objectContaining({
        action: "subscription.vendor_recase",
        actor: "system",
        details: { subscriptionId: created[0].id, from: "Xplace", to: "XPlace" },
      }),
    ]);
  });
});
