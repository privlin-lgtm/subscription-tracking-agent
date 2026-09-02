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
  ) {}

  async runRenewalReminders(): Promise<number> {
    const userIds = await this.users.listConnectedUserIds();
    const now = this.clock.now();
    const until = new Date(now);
    until.setDate(until.getDate() + this.renewalReminderDays);
    let emitted = 0;

    for (const userId of userIds) {
      const due = await this.subscriptions.listDueRenewals(userId, now, until);
      for (const item of due) {
        const cycleKey = item.nextRenewalDate?.toISOString().slice(0, 10) ?? "unknown";
        const created = await this.notifications.createIfAbsent({
          userId,
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
    }
    return emitted;
  }

  async runInactivityScan(): Promise<number> {
    const userIds = await this.users.listConnectedUserIds();
    const now = this.clock.now();
    let flagged = 0;

    for (const userId of userIds) {
      const graceMs = this.inactivityGraceCycles * 32 * 24 * 60 * 60 * 1000;
      const staleBefore = new Date(now.getTime() - graceMs);
      const stale = await this.subscriptions.listStaleActive(userId, staleBefore);
      for (const item of stale) {
        await this.subscriptions.update(item.id, { status: SubscriptionStatus.INACTIVE });
        await this.subscriptions.appendEvent({
          subscriptionId: item.id,
          eventType: EventType.FLAGGED_INACTIVE,
          payload: { staleBefore: staleBefore.toISOString() },
        });
        await this.notifications.createIfAbsent({
          userId,
          subscriptionId: item.id,
          type: "INACTIVITY",
          title: `Possibly unused: ${item.vendorNormalized}`,
          body: `${item.vendorNormalized} has not shown renewal activity and was marked inactive.`,
          idempotencyKey: `inactive:${item.id}:${now.toISOString().slice(0, 7)}`,
        });
        await this.audit.record({
          userId,
          action: "subscription.flag_inactive",
          actor: "system",
          details: { subscriptionId: item.id },
        });
        flagged += 1;
      }
    }
    return flagged;
  }

  async purgeExpiredSnapshots(): Promise<number> {
    return this.snapshots.purgeExpired(this.clock.now());
  }
}
