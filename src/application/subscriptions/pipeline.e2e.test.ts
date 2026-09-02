import { EventType, SubscriptionStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { createInboxHarness, TEST_USER_ID } from "@/test/inbox-harness";
import {
  CANCELLATION_CONFIRMED,
  DUPLICATE_RECEIPT,
  NEW_SUBSCRIPTION,
  PRICE_INCREASE,
  RECEIPT_LOOKALIKE,
  RENEWAL,
  TRIAL_START,
  TRIAL_UPGRADE,
} from "@/application/subscriptions/pipeline.fixtures";

describe("end-to-end inbox scenarios", () => {
  it("new subscription email creates one ACTIVE subscription", async () => {
    const { sync, subscriptions } = createInboxHarness([NEW_SUBSCRIPTION]);
    await sync.syncUser(TEST_USER_ID);
    const items = [...subscriptions.records.values()];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ vendorNormalized: "Netflix", status: SubscriptionStatus.ACTIVE, priceAmountCents: 1549 });
  });

  it("renewal email advances the date without creating a second row", async () => {
    const { sync, subscriptions } = createInboxHarness([NEW_SUBSCRIPTION, RENEWAL]);
    await sync.syncUser(TEST_USER_ID);
    expect(subscriptions.records.size).toBe(1);
    expect([...subscriptions.records.values()][0].nextRenewalDate?.toISOString().slice(0, 10)).toBe("2026-11-01");
    expect(subscriptions.events.map((event) => event.eventType)).toEqual([EventType.CREATED, EventType.RENEWED]);
  });

  it("cancellation email marks the subscription CANCELED", async () => {
    const { sync, subscriptions } = createInboxHarness([NEW_SUBSCRIPTION, CANCELLATION_CONFIRMED]);
    await sync.syncUser(TEST_USER_ID);
    expect([...subscriptions.records.values()][0].status).toBe(SubscriptionStatus.CANCELED);
    expect(subscriptions.events.map((event) => event.eventType)).toContain(EventType.CANCELED);
  });

  it("trial upgrade is a price change on the same subscription", async () => {
    const { sync, subscriptions, notifications } = createInboxHarness([TRIAL_START, TRIAL_UPGRADE]);
    await sync.syncUser(TEST_USER_ID);
    const record = [...subscriptions.records.values()][0];
    expect(subscriptions.records.size).toBe(1);
    expect(record.priceAmountCents).toBe(1549);
    expect(subscriptions.priceChanges).toEqual([
      expect.objectContaining({ oldAmountCents: 799, newAmountCents: 1549, currency: "USD" }),
    ]);
    expect(notifications.createIfAbsent).toHaveBeenCalledWith(expect.objectContaining({ type: "PRICE_INCREASE" }));
  });

  it("price increase records history and notifies", async () => {
    const { sync, subscriptions } = createInboxHarness([NEW_SUBSCRIPTION, PRICE_INCREASE]);
    await sync.syncUser(TEST_USER_ID);
    expect([...subscriptions.records.values()][0].priceAmountCents).toBe(1999);
    expect(subscriptions.priceChanges).toHaveLength(1);
  });

  it("duplicate receipt is a silent no-op", async () => {
    const { sync, subscriptions } = createInboxHarness([NEW_SUBSCRIPTION, DUPLICATE_RECEIPT]);
    await sync.syncUser(TEST_USER_ID);
    expect(subscriptions.records.size).toBe(1);
    expect(subscriptions.events).toHaveLength(1);
  });

  it("a receipt lookalike that is not a subscription creates no row", async () => {
    const { sync, subscriptions, processedEmails } = createInboxHarness([RECEIPT_LOOKALIKE]);
    await sync.syncUser(TEST_USER_ID);
    expect(subscriptions.records.size).toBe(0);
    expect(await processedEmails.exists(TEST_USER_ID, RECEIPT_LOOKALIKE.message.id)).toBe(true);
  });

  it("Gmail synchronization failure disconnects the inbox and creates no subscriptions", async () => {
    const { sync, subscriptions, gmail, notifications, users } = createInboxHarness([NEW_SUBSCRIPTION]);
    gmail.failAuth = true;

    const result = await sync.syncUser(TEST_USER_ID);

    expect(result.disconnected).toBe(true);
    expect(subscriptions.records.size).toBe(0);
    expect(users.updateGmailConnection).toHaveBeenCalledWith(
      TEST_USER_ID,
      expect.objectContaining({ gmailConnected: false }),
    );
    expect(notifications.createIfAbsent).toHaveBeenCalledWith(expect.objectContaining({ type: "GMAIL_DISCONNECTED" }));
  });
});
