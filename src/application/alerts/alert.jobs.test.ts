import { SubscriptionStatus } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import type { Clock } from "@/domain/ports";
import type { EmailSnapshotRepository, NotificationRepository, UserRepository } from "@/domain/repositories";
import { createInMemoryPersistence } from "@/application/subscriptions/in-memory-subscriptions";
import { AlertJobs } from "@/application/alerts/alert.jobs";

const NOW = new Date("2026-09-15T00:00:00Z");

function buildHarness(connectedUserIds: string[]) {
  const { subscriptions, audit } = createInMemoryPersistence();
  const users: UserRepository = {
    findByEmail: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    findOrCreateByEmail: vi.fn(),
    updateGmailConnection: vi.fn(async () => undefined),
    updateHistoryId: vi.fn(async () => undefined),
    listConnectedUserIds: vi.fn(async () => connectedUserIds),
  };
  const notifications: NotificationRepository = {
    createIfAbsent: vi.fn(async () => true),
    listByUser: vi.fn(async () => []),
    markRead: vi.fn(async () => undefined),
  };
  const snapshots: EmailSnapshotRepository = {
    save: vi.fn(async () => undefined),
    get: vi.fn(async () => null),
    purgeExpired: vi.fn(async () => 0),
  };
  const clock: Clock = { now: () => NOW };

  const alertJobs = new AlertJobs(users, subscriptions, notifications, snapshots, audit, clock, 7, 2, 180);

  return { alertJobs, subscriptions, audit, notifications, users };
}

describe("AlertJobs.runRenewalReminders", () => {
  it("issues one batched query across all connected users instead of one per user", async () => {
    const { alertJobs, subscriptions, notifications } = buildHarness(["user_a", "user_b"]);
    const dueSoon = new Date(NOW);
    dueSoon.setDate(dueSoon.getDate() + 3);

    await subscriptions.create({
      userId: "user_a",
      vendorNormalized: "Netflix",
      vendorRaw: "Netflix",
      status: SubscriptionStatus.ACTIVE,
      priceAmountCents: 1549,
      priceCurrency: "USD",
      billingCycle: "MONTHLY",
      nextRenewalDate: dueSoon,
      lastSeenEmailId: null,
      confidenceScore: 1,
    });
    await subscriptions.create({
      userId: "user_b",
      vendorNormalized: "Spotify",
      vendorRaw: "Spotify",
      status: SubscriptionStatus.ACTIVE,
      priceAmountCents: 999,
      priceCurrency: "USD",
      billingCycle: "MONTHLY",
      nextRenewalDate: dueSoon,
      lastSeenEmailId: null,
      confidenceScore: 1,
    });

    const batchSpy = vi.spyOn(subscriptions, "listDueRenewalsForUsers");
    const perUserSpy = vi.spyOn(subscriptions, "listDueRenewals");

    const emitted = await alertJobs.runRenewalReminders();

    expect(emitted).toBe(2);
    expect(batchSpy).toHaveBeenCalledTimes(1);
    expect(perUserSpy).not.toHaveBeenCalled();
    expect(notifications.createIfAbsent).toHaveBeenCalledWith(expect.objectContaining({ userId: "user_a" }));
    expect(notifications.createIfAbsent).toHaveBeenCalledWith(expect.objectContaining({ userId: "user_b" }));
  });

  it("does not query at all when no users are connected", async () => {
    const { alertJobs, subscriptions } = buildHarness([]);
    const batchSpy = vi.spyOn(subscriptions, "listDueRenewalsForUsers");

    expect(await alertJobs.runRenewalReminders()).toBe(0);
    expect(batchSpy).not.toHaveBeenCalled();
  });
});

describe("AlertJobs.runInactivityScan", () => {
  it("flags stale subscriptions across users atomically (status, event, and audit together) via one batched query", async () => {
    const { alertJobs, subscriptions, notifications, audit } = buildHarness(["user_a", "user_b"]);
    const staleAt = new Date(NOW);
    staleAt.setMonth(staleAt.getMonth() - 3);

    const a = await subscriptions.create({
      userId: "user_a",
      vendorNormalized: "OldGym",
      vendorRaw: "OldGym",
      status: SubscriptionStatus.ACTIVE,
      priceAmountCents: 5000,
      priceCurrency: "USD",
      billingCycle: "MONTHLY",
      nextRenewalDate: null,
      lastSeenEmailId: null,
      confidenceScore: 1,
    });
    // Backdate updatedAt directly — the in-memory double always stamps "now" on writes,
    // so this is the only way to simulate a subscription that's gone quiet.
    subscriptions.records.set(a.id, { ...subscriptions.records.get(a.id)!, updatedAt: staleAt });

    const b = await subscriptions.create({
      userId: "user_b",
      vendorNormalized: "Fresh",
      vendorRaw: "Fresh",
      status: SubscriptionStatus.ACTIVE,
      priceAmountCents: 999,
      priceCurrency: "USD",
      billingCycle: "MONTHLY",
      nextRenewalDate: null,
      lastSeenEmailId: null,
      confidenceScore: 1,
    });

    const batchSpy = vi.spyOn(subscriptions, "listStaleActiveForUsers");
    const perUserSpy = vi.spyOn(subscriptions, "listStaleActive");

    const flagged = await alertJobs.runInactivityScan();

    expect(flagged).toBe(1);
    expect(batchSpy).toHaveBeenCalledTimes(1);
    expect(perUserSpy).not.toHaveBeenCalled();
    expect(subscriptions.records.get(a.id)?.status).toBe(SubscriptionStatus.INACTIVE);
    expect(subscriptions.records.get(b.id)?.status).toBe(SubscriptionStatus.ACTIVE);
    expect(subscriptions.events).toEqual([
      expect.objectContaining({ subscriptionId: a.id, eventType: "FLAGGED_INACTIVE" }),
    ]);
    expect(notifications.createIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user_a", subscriptionId: a.id, type: "INACTIVITY" }),
    );
    expect(await audit.listByUser("user_a")).toEqual([
      expect.objectContaining({ action: "subscription.flag_inactive" }),
    ]);
  });
});

describe("AlertJobs.purgeOldAuditLogs", () => {
  it("removes only audit rows older than the retention window", async () => {
    const { alertJobs, audit } = buildHarness([]);
    const old = new Date(NOW);
    old.setDate(old.getDate() - 200);
    const recent = new Date(NOW);
    recent.setDate(recent.getDate() - 10);

    await audit.record({ userId: "user_a", action: "old", actor: "system", details: {} });
    await audit.record({ userId: "user_a", action: "recent", actor: "system", details: {} });
    // Backdate the two rows we just wrote so one falls outside the 180-day retention window.
    const rows = await audit.listByUser("user_a", 10);
    const oldRow = rows.find((r) => r.action === "old")!;
    const recentRow = rows.find((r) => r.action === "recent")!;
    oldRow.createdAt = old;
    recentRow.createdAt = recent;

    const purged = await alertJobs.purgeOldAuditLogs();

    expect(purged).toBe(1);
    const remaining = await audit.listByUser("user_a", 10);
    expect(remaining.map((r) => r.action)).toEqual(["recent"]);
  });
});
