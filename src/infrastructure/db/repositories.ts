import type {
  BillingCycle,
  EmailClassification,
  EventType,
  NotificationType,
  Prisma,
  ReviewDecisionType,
  SubscriptionStatus,
} from "@prisma/client";
import type {
  AuditRepository,
  CreateSubscriptionInput,
  EmailSnapshotRepository,
  NotificationRepository,
  ProcessedEmailRepository,
  ReviewRepository,
  SubscriptionRecord,
  SubscriptionRepository,
  SubscriptionUpdate,
  UserRepository,
  VendorAliasRepository,
} from "@/domain/repositories";
import { prisma } from "@/infrastructure/db/prisma";

export class PrismaSubscriptionRepository implements SubscriptionRepository {
  async listByUser(userId: string, status?: SubscriptionStatus): Promise<SubscriptionRecord[]> {
    return prisma.subscription.findMany({
      where: { userId, ...(status ? { status } : { status: { not: "DISMISSED" } }) },
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

  async recordPriceChange(input: {
    subscriptionId: string;
    oldAmountCents: number;
    newAmountCents: number;
    currency: string;
    sourceEmailId?: string | null;
  }): Promise<void> {
    await prisma.priceChange.create({ data: input });
  }

  listDueRenewals(userId: string, from: Date, to: Date): Promise<SubscriptionRecord[]> {
    return prisma.subscription.findMany({
      where: {
        userId,
        status: "ACTIVE",
        nextRenewalDate: { gte: from, lte: to },
      },
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

  create(email: string, passwordHash: string) {
    return prisma.user.create({
      data: { email, passwordHash },
      select: { id: true, email: true },
    });
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
  async record(input: {
    userId: string;
    action: string;
    actor: "system" | "user";
    details: Prisma.InputJsonValue;
  }) {
    await prisma.auditLog.create({ data: input });
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
    } catch {
      return false;
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
