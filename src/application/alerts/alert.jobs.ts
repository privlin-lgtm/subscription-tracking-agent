import { EventType, SubscriptionStatus } from "@prisma/client";
import type { Clock } from "@/domain/ports";
import type {
  AuditRepository,
  EmailSnapshotRepository,
  NotificationRepository,
  SubscriptionRepository,
  UserRepository,
} from "@/domain/repositories";

export class AlertJobs {
  constructor(
    private readonly users: UserRepository,
    private readonly subscriptions: SubscriptionRepository,
    private readonly notifications: NotificationRepository,
    private readonly snapshots: EmailSnapshotRepository,
    private readonly audit: AuditRepository,
    private readonly clock: Clock,
    private readonly renewalReminderDays: number,
    private readonly inactivityGraceCycles: number,
    private readonly auditLogRetentionDays: number,
  ) {}

  async runRenewalReminders(): Promise<number> {
    const userIds = await this.users.listConnectedUserIds();
    if (userIds.length === 0) {
      return 0;
    }
    const now = this.clock.now();
    const until = new Date(now);
    until.setDate(until.getDate() + this.renewalReminderDays);
    let emitted = 0;

    // One query across every connected user, not one query per user — see docs/phase6-database-review.md (D3).
    const due = await this.subscriptions.listDueRenewalsForUsers(userIds, now, until);
    for (const item of due) {
      const cycleKey = item.nextRenewalDate?.toISOString().slice(0, 10) ?? "unknown";
      const created = await this.notifications.createIfAbsent({
        userId: item.userId,
        subscriptionId: item.id,
        type: "RENEWAL_REMINDER",
        title: `Renewal soon: ${item.vendorNormalized}`,
        body: `${item.vendorNormalized} renews on ${cycleKey}.`,
        idempotencyKey: `renewal:${item.id}:${cycleKey}`,
      });
      if (created) {
        emitted += 1;
      }
    }
    return emitted;
  }

  async runInactivityScan(): Promise<number> {
    const userIds = await this.users.listConnectedUserIds();
    if (userIds.length === 0) {
      return 0;
    }
    const now = this.clock.now();
    const graceMs = this.inactivityGraceCycles * 32 * 24 * 60 * 60 * 1000;
    const staleBefore = new Date(now.getTime() - graceMs);
    let flagged = 0;

    // One query across every connected user, not one query per user — see docs/phase6-database-review.md (D3).
    const stale = await this.subscriptions.listStaleActiveForUsers(userIds, staleBefore);
    for (const item of stale) {
      // Subscription row, event, and audit entry commit atomically — see docs/phase6-database-review.md (D1).
      await this.subscriptions.applyWrite({
        update: { id: item.id, data: { status: SubscriptionStatus.INACTIVE } },
        events: [{ eventType: EventType.FLAGGED_INACTIVE, payload: { staleBefore: staleBefore.toISOString() } }],
        audit: {
          userId: item.userId,
          action: "subscription.flag_inactive",
          actor: "system",
          details: { subscriptionId: item.id },
        },
      });
      await this.notifications.createIfAbsent({
        userId: item.userId,
        subscriptionId: item.id,
        type: "INACTIVITY",
        title: `Possibly unused: ${item.vendorNormalized}`,
        body: `${item.vendorNormalized} has not shown renewal activity and was marked inactive.`,
        idempotencyKey: `inactive:${item.id}:${now.toISOString().slice(0, 7)}`,
      });
      flagged += 1;
    }
    return flagged;
  }

  async purgeExpiredSnapshots(): Promise<number> {
    return this.snapshots.purgeExpired(this.clock.now());
  }

  /**
   * SubscriptionEvent/PriceChange are the product's permanent historical record and are kept
   * forever by design. AuditLog is a system/diagnostic trail, not user-facing history, so it
   * gets a retention window instead — see docs/phase6-database-review.md (D2).
   */
  async purgeOldAuditLogs(): Promise<number> {
    const cutoff = new Date(this.clock.now());
    cutoff.setDate(cutoff.getDate() - this.auditLogRetentionDays);
    return this.audit.purgeOlderThan(cutoff);
  }
}
