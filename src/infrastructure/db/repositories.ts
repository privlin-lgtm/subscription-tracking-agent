import { Prisma, SubscriptionStatus } from "@prisma/client";
import type { BillingCycle, EmailClassification, EventType, NotificationType, ReviewDecisionType } from "@prisma/client";
import type {
  AuditInput,
  AuditRecord,
  AuditRepository,
  CreateSubscriptionInput,
  EmailSnapshotRepository,
  NotificationRepository,
  PriceChangeInput,
  PriceChangeRecord,
  ProcessedEmailRepository,
  ReviewRepository,
  SubscriptionEventRecord,
  SubscriptionRecord,
  SubscriptionRepository,
  SubscriptionUpdate,
  SubscriptionWrite,
  UserRepository,
  VendorAliasRepository,
} from "@/domain/repositories";
import { prisma } from "@/infrastructure/db/prisma";

export class PrismaSubscriptionRepository implements SubscriptionRepository {
  async listByUser(
    userId: string,
    status?: SubscriptionStatus | SubscriptionStatus[],
  ): Promise<SubscriptionRecord[]> {
    const statusFilter = Array.isArray(status)
      ? { in: status }
      : status
        ? status
        : { not: SubscriptionStatus.DISMISSED };
    return prisma.subscription.findMany({
      where: { userId, status: statusFilter },
      orderBy: { updatedAt: "desc" },
    });
  }

  getByIdForUser(userId: string, id: string): Promise<SubscriptionRecord | null> {
    return prisma.subscription.findFirst({ where: { id, userId } });
  }

  findActiveByVendor(userId: string, vendorNormalized: string): Promise<SubscriptionRecord[]> {
    return prisma.subscription.findMany({
      where: {
        userId,
        vendorNormalized,
        status: { in: ["ACTIVE", "INACTIVE", "PENDING_REVIEW"] },
      },
    });
  }

  create(input: CreateSubscriptionInput): Promise<SubscriptionRecord> {
    return prisma.subscription.create({ data: input });
  }

  update(id: string, data: SubscriptionUpdate): Promise<SubscriptionRecord> {
    return prisma.subscription.update({ where: { id }, data });
  }

  async appendEvent(input: {
    subscriptionId: string;
    eventType: EventType;
    sourceEmailId?: string | null;
    payload: Prisma.InputJsonValue;
  }): Promise<void> {
    await prisma.subscriptionEvent.create({ data: input });
  }

  async recordPriceChange(input: PriceChangeInput & { subscriptionId: string }): Promise<void> {
    await prisma.priceChange.create({ data: input });
  }

  listEvents(userId: string, subscriptionId: string): Promise<SubscriptionEventRecord[]> {
    return prisma.subscriptionEvent.findMany({
      where: { subscriptionId, subscription: { userId } },
      orderBy: { createdAt: "desc" },
    });
  }

  listPriceChanges(userId: string, subscriptionId: string): Promise<PriceChangeRecord[]> {
    return prisma.priceChange.findMany({
      where: { subscriptionId, subscription: { userId } },
      orderBy: { detectedAt: "desc" },
    });
  }

  async applyWrite(write: SubscriptionWrite): Promise<SubscriptionRecord> {
    return prisma.$transaction(async (tx) => {
      let record: SubscriptionRecord;
      if (write.create) {
        record = await tx.subscription.create({ data: write.create });
      } else if (write.update) {
        record = await tx.subscription.update({
          where: { id: write.update.id },
          data: write.update.data,
        });
      } else {
        throw new Error("Subscription write must create or update a row");
      }

      for (const event of write.events ?? []) {
        await tx.subscriptionEvent.create({
          data: { ...event, subscriptionId: record.id },
        });
      }
      if (write.priceChange) {
        await tx.priceChange.create({
          data: { ...write.priceChange, subscriptionId: record.id },
        });
      }
      if (write.audit) {
        await tx.auditLog.create({ data: write.audit });
      }
      return record;
    });
  }

  listDueRenewals(userId: string, from: Date, to: Date): Promise<SubscriptionRecord[]> {
    return prisma.subscription.findMany({
      where: {
        userId,
        status: "ACTIVE",
        nextRenewalDate: { gte: from, lte: to },
      },
      orderBy: { nextRenewalDate: "asc" },
    });
  }

  listStaleActive(userId: string, staleBefore: Date): Promise<SubscriptionRecord[]> {
    return prisma.subscription.findMany({
      where: {
        userId,
        status: "ACTIVE",
        nextRenewalDate: { lt: staleBefore },
      },
    });
  }

  listDueRenewalsForUsers(userIds: string[], from: Date, to: Date): Promise<SubscriptionRecord[]> {
    if (userIds.length === 0) {
      return Promise.resolve([]);
    }
    return prisma.subscription.findMany({
      where: {
        userId: { in: userIds },
        status: "ACTIVE",
        nextRenewalDate: { gte: from, lte: to },
      },
      orderBy: [{ userId: "asc" }, { nextRenewalDate: "asc" }],
    });
  }

  listStaleActiveForUsers(userIds: string[], staleBefore: Date): Promise<SubscriptionRecord[]> {
    if (userIds.length === 0) {
      return Promise.resolve([]);
    }
    return prisma.subscription.findMany({
      where: {
        userId: { in: userIds },
        status: "ACTIVE",
        nextRenewalDate: { lt: staleBefore },
      },
      orderBy: [{ userId: "asc" }],
    });
  }
}

export class PrismaUserRepository implements UserRepository {
  findByEmail(email: string) {
    return prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, passwordHash: true },
    });
  }

  findById(id: string) {
    return prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        gmailConnected: true,
        gmailRefreshToken: true,
        gmailHistoryId: true,
      },
    });
  }

  create(email: string, passwordHash?: string | null) {
    return prisma.user.create({
      data: { email, passwordHash: passwordHash ?? null },
      select: { id: true, email: true },
    });
  }

  async findOrCreateByEmail(email: string) {
    const existing = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true },
    });
    if (existing) {
      return existing;
    }
    try {
      return await this.create(email, null);
    } catch {
      const raced = await prisma.user.findUnique({
        where: { email },
        select: { id: true, email: true },
      });
      if (!raced) {
        throw new Error("Unable to create user");
      }
      return raced;
    }
  }

  async updateGmailConnection(
    userId: string,
    data: {
      gmailRefreshToken?: string | null;
      gmailConnected: boolean;
      gmailHistoryId?: string | null;
      gmailDisconnectedAt?: Date | null;
    },
  ) {
    await prisma.user.update({ where: { id: userId }, data });
  }

  async updateHistoryId(userId: string, historyId: string) {
    await prisma.user.update({ where: { id: userId }, data: { gmailHistoryId: historyId } });
  }

  async listConnectedUserIds() {
    const rows = await prisma.user.findMany({
      where: { gmailConnected: true },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  async deleteAccount(userId: string) {
    await prisma.user.delete({ where: { id: userId } });
  }
}

export class PrismaProcessedEmailRepository implements ProcessedEmailRepository {
  async exists(userId: string, gmailMessageId: string) {
    const row = await prisma.processedEmail.findUnique({
      where: { userId_gmailMessageId: { userId, gmailMessageId } },
      select: { id: true },
    });
    return Boolean(row);
  }

  async record(input: {
    userId: string;
    gmailMessageId: string;
    gmailHistoryId: string;
    classification: EmailClassification;
  }) {
    await prisma.processedEmail.upsert({
      where: { userId_gmailMessageId: { userId: input.userId, gmailMessageId: input.gmailMessageId } },
      update: { classification: input.classification, gmailHistoryId: input.gmailHistoryId },
      create: input,
    });
  }
}

export class PrismaAuditRepository implements AuditRepository {
  async record(input: AuditInput) {
    await prisma.auditLog.create({ data: input });
  }

  listByUser(userId: string, limit = 50): Promise<AuditRecord[]> {
    return prisma.auditLog.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  async purgeOlderThan(cutoff: Date): Promise<number> {
    const result = await prisma.auditLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
    return result.count;
  }
}

export class PrismaNotificationRepository implements NotificationRepository {
  async createIfAbsent(input: {
    userId: string;
    subscriptionId?: string | null;
    type: NotificationType;
    title: string;
    body: string;
    idempotencyKey: string;
  }) {
    try {
      await prisma.notification.create({ data: input });
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return false;
      }
      throw error;
    }
  }

  listByUser(userId: string) {
    return prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { id: true, type: true, title: true, body: true, status: true, createdAt: true },
    });
  }

  async markRead(userId: string, id: string) {
    await prisma.notification.updateMany({
      where: { id, userId },
      data: { status: "READ" },
    });
  }
}

export class PrismaVendorAliasRepository implements VendorAliasRepository {
  async findCanonical(alias: string) {
    const row = await prisma.vendorAlias.findUnique({ where: { alias } });
    return row?.canonicalName ?? null;
  }

  async listCanonicalNames() {
    const rows = await prisma.vendorAlias.findMany({ distinct: ["canonicalName"], select: { canonicalName: true } });
    return rows.map((row) => row.canonicalName);
  }
}

export class PrismaReviewRepository implements ReviewRepository {
  async recordDecision(input: {
    subscriptionId: string;
    userId: string;
    decision: ReviewDecisionType;
    notes?: string | null;
    editedPayload?: Prisma.InputJsonValue;
  }) {
    await prisma.reviewDecision.create({ data: input });
  }
}

export class PrismaEmailSnapshotRepository implements EmailSnapshotRepository {
  async save(input: {
    userId: string;
    gmailMessageId: string;
    subject: string;
    sender: string;
    bodyText: string;
    expiresAt: Date;
  }) {
    await prisma.emailSnapshot.upsert({
      where: { userId_gmailMessageId: { userId: input.userId, gmailMessageId: input.gmailMessageId } },
      update: input,
      create: input,
    });
  }

  get(userId: string, gmailMessageId: string) {
    return prisma.emailSnapshot.findUnique({
      where: { userId_gmailMessageId: { userId, gmailMessageId } },
      select: { subject: true, sender: true, bodyText: true },
    });
  }

  async purgeExpired(now: Date) {
    const result = await prisma.emailSnapshot.deleteMany({ where: { expiresAt: { lte: now } } });
    return result.count;
  }
}

export type { BillingCycle };
