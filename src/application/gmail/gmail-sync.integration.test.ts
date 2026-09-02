import { EventType, SubscriptionStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { createInboxHarness, TEST_USER_ID } from "@/test/inbox-harness";
import {
  CANCELLATION_CONFIRMED,
  NEW_SUBSCRIPTION,
  PRICE_INCREASE,
  RENEWAL,
} from "@/application/subscriptions/pipeline.fixtures";

describe("integration: Gmail sync through persistence and alerts", () => {
  it("creates a new subscription from a synced receipt", async () => {
    const { sync, subscriptions } = createInboxHarness([NEW_SUBSCRIPTION]);

    const result = await sync.syncUser(TEST_USER_ID);

    expect(result).toEqual({ processed: 1, skipped: 0 });
    const record = [...subscriptions.records.values()][0];
    expect(record.status).toBe(SubscriptionStatus.ACTIVE);
    expect(record.vendorNormalized).toBe("Netflix");
    expect(subscriptions.events.map((event) => event.eventType)).toEqual([EventType.CREATED]);
  });

  it("detects a renewal on the next incremental sync", async () => {
    const first = createInboxHarness([NEW_SUBSCRIPTION]);
    await first.sync.syncUser(TEST_USER_ID);

    const second = createInboxHarness([RENEWAL]);
    second.subscriptions.records = first.subscriptions.records;
    second.subscriptions.events = first.subscriptions.events;

    await second.sync.syncUser(TEST_USER_ID);

    const record = [...second.subscriptions.records.values()][0];
    expect(record.nextRenewalDate?.toISOString().slice(0, 10)).toBe("2026-11-01");
    expect(second.subscriptions.events.map((event) => event.eventType)).toEqual([EventType.CREATED, EventType.RENEWED]);
  });

  it("records a price update and notifies", async () => {
    const first = createInboxHarness([NEW_SUBSCRIPTION]);
    await first.sync.syncUser(TEST_USER_ID);

    const second = createInboxHarness([PRICE_INCREASE]);
    second.subscriptions.records = first.subscriptions.records;
    second.subscriptions.events = first.subscriptions.events;
    second.subscriptions.priceChanges = first.subscriptions.priceChanges;

    await second.sync.syncUser(TEST_USER_ID);

    expect([...second.subscriptions.records.values()][0].priceAmountCents).toBe(1999);
    expect(second.subscriptions.priceChanges).toHaveLength(1);
    expect(second.notifications.createIfAbsent).toHaveBeenCalledWith(expect.objectContaining({ type: "PRICE_INCREASE" }));
  });

  it("cancels the matching subscription from a cancellation email", async () => {
    const first = createInboxHarness([NEW_SUBSCRIPTION]);
    await first.sync.syncUser(TEST_USER_ID);

    const second = createInboxHarness([CANCELLATION_CONFIRMED]);
    second.subscriptions.records = first.subscriptions.records;
    second.subscriptions.events = first.subscriptions.events;

    await second.sync.syncUser(TEST_USER_ID);

    expect([...second.subscriptions.records.values()][0].status).toBe(SubscriptionStatus.CANCELED);
  });

  it("emits a renewal reminder after a subscription is synced", async () => {
    const { sync, alerts, notifications } = createInboxHarness([NEW_SUBSCRIPTION]);
    await sync.syncUser(TEST_USER_ID);

    const emitted = await alerts.runRenewalReminders();

    expect(emitted).toBe(1);
    expect(notifications.createIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "RENEWAL_REMINDER", title: "Renewal soon: Netflix" }),
    );
  });
});
