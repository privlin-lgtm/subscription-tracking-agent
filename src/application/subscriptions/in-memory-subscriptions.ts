import { randomUUID } from "node:crypto";
import { SubscriptionStatus } from "@prisma/client";
import type {
  AuditInput,
  AuditRecord,
  AuditRepository,
  CreateSubscriptionInput,
  PriceChangeInput,
  PriceChangeRecord,
  SubscriptionEventInput,
  SubscriptionEventRecord,
  SubscriptionRecord,
  SubscriptionRepository,
  SubscriptionUpdate,
  SubscriptionWrite,
} from "@/domain/repositories";

export class InMemorySubscriptions implements SubscriptionRepository {
  records = new Map<string, SubscriptionRecord>();
  events: SubscriptionEventRecord[] = [];
  priceChanges: PriceChangeRecord[] = [];

  constructor(private readonly auditRows: AuditRecord[] = []) {}

  async listByUser(
    userId: string,
    status?: SubscriptionStatus | SubscriptionStatus[],
  ): Promise<SubscriptionRecord[]> {
    const statuses = Array.isArray(status) ? status : status ? [status] : null;
    return [...this.records.values()].filter((record) => {
      if (record.userId !== userId) {
        return false;
      }
      if (statuses) {
        return statuses.includes(record.status);
      }
      return record.status !== SubscriptionStatus.DISMISSED;
    });
  }

  async getByIdForUser(userId: string, id: string): Promise<SubscriptionRecord | null> {
    const record = this.records.get(id);
    return record && record.userId === userId ? record : null;
  }

  async findActiveByVendor(userId: string, vendorNormalized: string): Promise<SubscriptionRecord[]> {
    return [...this.records.values()].filter(
      (record) =>
        record.userId === userId && record.vendorNormalized.toLowerCase() === vendorNormalized.toLowerCase(),
    );
  }

  async create(input: CreateSubscriptionInput): Promise<SubscriptionRecord> {
    const record: SubscriptionRecord = {
      id: randomUUID(),
      reviewReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...input,
    };
    this.records.set(record.id, record);
    return record;
  }

  async update(id: string, data: SubscriptionUpdate): Promise<SubscriptionRecord> {
    const existing = this.records.get(id);
    if (!existing) {
      throw new Error(`unknown subscription ${id}`);
    }
    const updated = { ...existing, ...data, updatedAt: new Date() };
    this.records.set(id, updated);
    return updated;
  }

  async appendEvent(input: SubscriptionEventInput & { subscriptionId: string }): Promise<void> {
    this.events.push({
      id: randomUUID(),
      subscriptionId: input.subscriptionId,
      eventType: input.eventType,
      sourceEmailId: input.sourceEmailId ?? null,
      payload: input.payload,
      createdAt: new Date(),
    });
  }

  async recordPriceChange(input: PriceChangeInput & { subscriptionId: string }): Promise<void> {
    this.priceChanges.push({
      id: randomUUID(),
      subscriptionId: input.subscriptionId,
      oldAmountCents: input.oldAmountCents,
      newAmountCents: input.newAmountCents,
      currency: input.currency,
      sourceEmailId: input.sourceEmailId ?? null,
      detectedAt: new Date(),
    });
  }

  async listEvents(userId: string, subscriptionId: string): Promise<SubscriptionEventRecord[]> {
    if (this.records.get(subscriptionId)?.userId !== userId) {
      return [];
    }
    return this.events
      .filter((event) => event.subscriptionId === subscriptionId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async listPriceChanges(userId: string, subscriptionId: string): Promise<PriceChangeRecord[]> {
    if (this.records.get(subscriptionId)?.userId !== userId) {
      return [];
    }
    return this.priceChanges
      .filter((change) => change.subscriptionId === subscriptionId)
      .sort((a, b) => b.detectedAt.getTime() - a.detectedAt.getTime());
  }

  async listDueRenewals(userId: string, from: Date, to: Date): Promise<SubscriptionRecord[]> {
    return [...this.records.values()].filter((record) => {
      if (record.userId !== userId || record.status !== SubscriptionStatus.ACTIVE || !record.nextRenewalDate) {
        return false;
      }
      const time = record.nextRenewalDate.getTime();
      return time >= from.getTime() && time <= to.getTime();
    }).sort((a, b) => (a.nextRenewalDate?.getTime() ?? 0) - (b.nextRenewalDate?.getTime() ?? 0));
  }

  async listStaleActive(userId: string, staleBefore: Date): Promise<SubscriptionRecord[]> {
    return [...this.records.values()].filter(
      (record) =>
        record.userId === userId &&
        record.status === SubscriptionStatus.ACTIVE &&
        record.updatedAt.getTime() < staleBefore.getTime(),
    );
  }

  async listDueRenewalsForUsers(userIds: string[], from: Date, to: Date): Promise<SubscriptionRecord[]> {
    const idSet = new Set(userIds);
    return [...this.records.values()]
      .filter(
        (record) =>
          idSet.has(record.userId) &&
          record.status === SubscriptionStatus.ACTIVE &&
          record.nextRenewalDate &&
          record.nextRenewalDate.getTime() >= from.getTime() &&
          record.nextRenewalDate.getTime() <= to.getTime(),
      )
      .sort((a, b) => (a.nextRenewalDate?.getTime() ?? 0) - (b.nextRenewalDate?.getTime() ?? 0));
  }

  async listStaleActiveForUsers(userIds: string[], staleBefore: Date): Promise<SubscriptionRecord[]> {
    const idSet = new Set(userIds);
    return [...this.records.values()].filter(
      (record) =>
        idSet.has(record.userId) &&
        record.status === SubscriptionStatus.ACTIVE &&
        record.updatedAt.getTime() < staleBefore.getTime(),
    );
  }

  async applyWrite(write: SubscriptionWrite): Promise<SubscriptionRecord> {
    let record: SubscriptionRecord;
    if (write.create) {
      record = await this.create(write.create);
    } else if (write.update) {
      record = await this.update(write.update.id, write.update.data);
    } else {
      throw new Error("Subscription write must create or update a row");
    }

    for (const event of write.events ?? []) {
      await this.appendEvent({ ...event, subscriptionId: record.id });
    }
    if (write.priceChange) {
      await this.recordPriceChange({ ...write.priceChange, subscriptionId: record.id });
    }
    if (write.audit) {
      this.auditRows.push({
        id: randomUUID(),
        userId: write.audit.userId,
        action: write.audit.action,
        actor: write.audit.actor,
        details: write.audit.details,
        createdAt: new Date(),
      });
    }
    return record;
  }
}

export class InMemoryAudit implements AuditRepository {
  constructor(private readonly rows: AuditRecord[] = []) {}

  async record(input: AuditInput): Promise<void> {
    this.rows.push({
      id: randomUUID(),
      userId: input.userId,
      action: input.action,
      actor: input.actor,
      details: input.details,
      createdAt: new Date(),
    });
  }

  async listByUser(userId: string, limit = 50): Promise<AuditRecord[]> {
    return this.rows
      .filter((row) => row.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  async purgeOlderThan(cutoff: Date): Promise<number> {
    const before = this.rows.length;
    const kept = this.rows.filter((row) => row.createdAt.getTime() >= cutoff.getTime());
    this.rows.length = 0;
    this.rows.push(...kept);
    return before - kept.length;
  }
}

export function createInMemoryPersistence() {
  const auditRows: AuditRecord[] = [];
  return {
    subscriptions: new InMemorySubscriptions(auditRows),
    audit: new InMemoryAudit(auditRows),
  };
}
