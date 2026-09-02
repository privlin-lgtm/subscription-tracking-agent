import type {
  BillingCycle,
  EmailClassification,
  EventType,
  NotificationStatus,
  NotificationType,
  ReviewDecisionType,
  SubscriptionStatus,
} from "@prisma/client";
import type { Prisma } from "@prisma/client";

export type SubscriptionRecord = {
  id: string;
  userId: string;
  vendorNormalized: string;
  vendorRaw: string;
  status: SubscriptionStatus;
  priceAmountCents: number;
  priceCurrency: string;
  billingCycle: BillingCycle;
  nextRenewalDate: Date | null;
  lastSeenEmailId: string | null;
  confidenceScore: number;
  reviewReason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateSubscriptionInput = {
  userId: string;
  vendorNormalized: string;
  vendorRaw: string;
  status: SubscriptionStatus;
  priceAmountCents: number;
  priceCurrency: string;
  billingCycle: BillingCycle;
  nextRenewalDate: Date | null;
  lastSeenEmailId: string | null;
  confidenceScore: number;
  reviewReason?: string | null;
};

export type SubscriptionUpdate = Partial<
  Pick<
    SubscriptionRecord,
    | "status"
    | "vendorNormalized"
    | "vendorRaw"
    | "priceAmountCents"
    | "priceCurrency"
    | "billingCycle"
    | "nextRenewalDate"
    | "lastSeenEmailId"
    | "confidenceScore"
    | "reviewReason"
  >
>;

export interface SubscriptionRepository {
  listByUser(userId: string, status?: SubscriptionStatus): Promise<SubscriptionRecord[]>;
  getByIdForUser(userId: string, id: string): Promise<SubscriptionRecord | null>;
  findActiveByVendor(userId: string, vendorNormalized: string): Promise<SubscriptionRecord[]>;
  create(input: CreateSubscriptionInput): Promise<SubscriptionRecord>;
  update(id: string, data: SubscriptionUpdate): Promise<SubscriptionRecord>;
  appendEvent(input: {
    subscriptionId: string;
    eventType: EventType;
    sourceEmailId?: string | null;
    payload: Prisma.InputJsonValue;
  }): Promise<void>;
  recordPriceChange(input: {
    subscriptionId: string;
    oldAmountCents: number;
    newAmountCents: number;
    currency: string;
    sourceEmailId?: string | null;
  }): Promise<void>;
  listDueRenewals(userId: string, from: Date, to: Date): Promise<SubscriptionRecord[]>;
  listStaleActive(userId: string, staleBefore: Date): Promise<SubscriptionRecord[]>;
}

export interface UserRepository {
  findByEmail(email: string): Promise<{ id: string; email: string; passwordHash: string } | null>;
  findById(id: string): Promise<{
    id: string;
    email: string;
    gmailConnected: boolean;
    gmailRefreshToken: string | null;
    gmailHistoryId: string | null;
  } | null>;
  create(email: string, passwordHash: string): Promise<{ id: string; email: string }>;
  updateGmailConnection(
    userId: string,
    data: {
      gmailRefreshToken?: string | null;
      gmailConnected: boolean;
      gmailHistoryId?: string | null;
      gmailDisconnectedAt?: Date | null;
    },
  ): Promise<void>;
  updateHistoryId(userId: string, historyId: string): Promise<void>;
  listConnectedUserIds(): Promise<string[]>;
}

export interface ProcessedEmailRepository {
  exists(userId: string, gmailMessageId: string): Promise<boolean>;
  record(input: {
    userId: string;
    gmailMessageId: string;
    gmailHistoryId: string;
    classification: EmailClassification;
  }): Promise<void>;
}

export interface AuditRepository {
  record(input: {
    userId: string;
    action: string;
    actor: "system" | "user";
    details: Prisma.InputJsonValue;
  }): Promise<void>;
}

export interface NotificationRepository {
  createIfAbsent(input: {
    userId: string;
    subscriptionId?: string | null;
    type: NotificationType;
    title: string;
    body: string;
    idempotencyKey: string;
  }): Promise<boolean>;
  listByUser(userId: string): Promise<
    Array<{
      id: string;
      type: NotificationType;
      title: string;
      body: string;
      status: NotificationStatus;
      createdAt: Date;
    }>
  >;
  markRead(userId: string, id: string): Promise<void>;
}

export interface VendorAliasRepository {
  findCanonical(alias: string): Promise<string | null>;
  listCanonicalNames(): Promise<string[]>;
}

export interface ReviewRepository {
  recordDecision(input: {
    subscriptionId: string;
    userId: string;
    decision: ReviewDecisionType;
    notes?: string | null;
    editedPayload?: Prisma.InputJsonValue;
  }): Promise<void>;
}

export interface EmailSnapshotRepository {
  save(input: {
    userId: string;
    gmailMessageId: string;
    subject: string;
    sender: string;
    bodyText: string;
    expiresAt: Date;
  }): Promise<void>;
  get(userId: string, gmailMessageId: string): Promise<{
    subject: string;
    sender: string;
    bodyText: string;
  } | null>;
  purgeExpired(now: Date): Promise<number>;
}
