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

export type SubscriptionEventRecord = {
  id: string;
  subscriptionId: string;
  eventType: EventType;
  sourceEmailId: string | null;
  payload: unknown;
  createdAt: Date;
};

export type PriceChangeRecord = {
  id: string;
  subscriptionId: string;
  oldAmountCents: number;
  newAmountCents: number;
  currency: string;
  detectedAt: Date;
  sourceEmailId: string | null;
};

export type AuditRecord = {
  id: string;
  userId: string;
  action: string;
  actor: string;
  details: unknown;
  createdAt: Date;
};

export type SubscriptionEventInput = {
  eventType: EventType;
  sourceEmailId?: string | null;
  payload: Prisma.InputJsonValue;
};

export type PriceChangeInput = {
  oldAmountCents: number;
  newAmountCents: number;
  currency: string;
  sourceEmailId?: string | null;
};

export type AuditInput = {
  userId: string;
  action: string;
  actor: "system" | "user";
  details: Prisma.InputJsonValue;
};

export type SubscriptionWrite = {
  create?: CreateSubscriptionInput;
  update?: { id: string; data: SubscriptionUpdate };
  events?: SubscriptionEventInput[];
  priceChange?: PriceChangeInput;
  audit?: AuditInput;
};

export interface SubscriptionRepository {
  listByUser(userId: string, status?: SubscriptionStatus | SubscriptionStatus[]): Promise<SubscriptionRecord[]>;
  getByIdForUser(userId: string, id: string): Promise<SubscriptionRecord | null>;
  findActiveByVendor(userId: string, vendorNormalized: string): Promise<SubscriptionRecord[]>;
  create(input: CreateSubscriptionInput): Promise<SubscriptionRecord>;
  update(id: string, data: SubscriptionUpdate): Promise<SubscriptionRecord>;
  appendEvent(input: SubscriptionEventInput & { subscriptionId: string }): Promise<void>;
  recordPriceChange(input: PriceChangeInput & { subscriptionId: string }): Promise<void>;
  listEvents(userId: string, subscriptionId: string): Promise<SubscriptionEventRecord[]>;
  listPriceChanges(userId: string, subscriptionId: string): Promise<PriceChangeRecord[]>;
  listDueRenewals(userId: string, from: Date, to: Date): Promise<SubscriptionRecord[]>;
  listStaleActive(userId: string, staleBefore: Date): Promise<SubscriptionRecord[]>;
  /** Batch variants used by scheduled jobs so they issue one query across all connected users instead of one per user. */
  listDueRenewalsForUsers(userIds: string[], from: Date, to: Date): Promise<SubscriptionRecord[]>;
  listStaleActiveForUsers(userIds: string[], staleBefore: Date): Promise<SubscriptionRecord[]>;
  applyWrite(write: SubscriptionWrite): Promise<SubscriptionRecord>;
}

export interface UserRepository {
  findByEmail(email: string): Promise<{ id: string; email: string; passwordHash: string | null } | null>;
  findById(id: string): Promise<{
    id: string;
    email: string;
    gmailConnected: boolean;
    gmailRefreshToken: string | null;
    gmailHistoryId: string | null;
  } | null>;
  create(email: string, passwordHash?: string | null): Promise<{ id: string; email: string }>;
  findOrCreateByEmail(email: string): Promise<{ id: string; email: string }>;
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
  record(input: AuditInput): Promise<void>;
  listByUser(userId: string, limit?: number): Promise<AuditRecord[]>;
  /** Deletes audit rows older than `cutoff`, returning the number removed. */
  purgeOlderThan(cutoff: Date): Promise<number>;
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
