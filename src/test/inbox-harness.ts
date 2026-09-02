import { vi } from "vitest";
import type { Clock, ExtractionAgent, ExtractionInput, ExtractionResult, GmailClient, GmailMessage, TokenEncryptor } from "@/domain/ports";
import type {
  AuditRecord,
  EmailSnapshotRepository,
  NotificationRepository,
  ProcessedEmailRepository,
  UserRepository,
  VendorAliasRepository,
} from "@/domain/repositories";
import { GmailAuthError } from "@/domain/errors";
import { InMemorySubscriptions } from "@/application/subscriptions/in-memory-subscriptions";
import { SubscriptionPipelineService } from "@/application/subscriptions/subscription-pipeline.service";
import { GmailSyncService } from "@/application/gmail/gmail-sync.service";
import { AlertJobs } from "@/application/alerts/alert.jobs";
import type { PipelineFixture } from "@/application/subscriptions/pipeline.fixtures";

export const TEST_USER_ID = "user_1";
export const AUTO_APPLY_THRESHOLD = 0.85;
export const FUZZY_THRESHOLD = 0.88;

export class InMemoryProcessedEmails implements ProcessedEmailRepository {
  seen = new Map<string, string>();

  async exists(userId: string, gmailMessageId: string): Promise<boolean> {
    return this.seen.has(`${userId}:${gmailMessageId}`);
  }

  async record(input: {
    userId: string;
    gmailMessageId: string;
    gmailHistoryId: string;
    classification: string;
  }): Promise<void> {
    this.seen.set(`${input.userId}:${input.gmailMessageId}`, input.classification);
  }
}

export class InMemoryVendorAliases implements VendorAliasRepository {
  constructor(private readonly rows: Array<{ alias: string; canonicalName: string }>) {}

  async findCanonical(alias: string): Promise<string | null> {
    return this.rows.find((row) => row.alias === alias)?.canonicalName ?? null;
  }

  async listCanonicalNames(): Promise<string[]> {
    return [...new Set(this.rows.map((row) => row.canonicalName))];
  }
}

export class FixtureExtractor implements ExtractionAgent {
  constructor(private readonly bySubject: Map<string, ExtractionResult | "extraction_failure">) {}

  async extract(input: ExtractionInput): Promise<ExtractionResult> {
    const result = this.bySubject.get(input.subject);
    if (result === undefined || result === "extraction_failure") {
      throw new Error("extraction failed");
    }
    return result;
  }
}

export class InboxGmail implements GmailClient {
  failAuth = false;
  thrown: unknown = null;

  constructor(private readonly messages: GmailMessage[]) {}

  async listHistory() {
    if (this.failAuth) {
      throw new GmailAuthError();
    }
    if (this.thrown) {
      throw this.thrown;
    }
    return {
      messageIds: this.messages.map((message) => message.id),
      latestHistoryId: "99",
      expired: false,
    };
  }

  async listRelevantMessages() {
    return this.messages.map((message) => message.id);
  }

  async getMetadata(_token: string, id: string) {
    const message = this.messages.find((item) => item.id === id);
    if (!message) {
      throw new Error(`unknown message ${id}`);
    }
    return {
      id: message.id,
      historyId: message.historyId,
      threadId: message.threadId,
      subject: message.subject,
      sender: message.sender,
      snippet: message.snippet,
    };
  }

  async getMessage(_token: string, id: string) {
    if (this.failAuth) {
      throw new GmailAuthError();
    }
    const message = this.messages.find((item) => item.id === id);
    if (!message) {
      throw new Error(`unknown message ${id}`);
    }
    return message;
  }

  async getProfileHistoryId() {
    return "99";
  }

  async revokeRefreshToken() {
    return undefined;
  }
}

export function createInboxHarness(fixtures: PipelineFixture[], options?: { historyId?: string | null; connected?: boolean }) {
  const extractionBySubject = new Map<string, ExtractionResult | "extraction_failure">(
    fixtures.map((fixture) => [fixture.message.subject, fixture.extraction]),
  );
  const auditRows: AuditRecord[] = [];
  const subscriptions = new InMemorySubscriptions(auditRows);
  const processedEmails = new InMemoryProcessedEmails();
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
  const vendorAliases = new InMemoryVendorAliases([
    { alias: "netflix", canonicalName: "Netflix" },
    { alias: "amazon prime video", canonicalName: "Amazon Prime Video" },
  ]);
  const gmail = new InboxGmail(fixtures.map((fixture) => fixture.message));
  const encryptor: TokenEncryptor = {
    encrypt: (value) => `enc:${value}`,
    decrypt: (value) => value.replace(/^enc:/, ""),
  };
  const clock: Clock = { now: () => new Date("2026-09-15T00:00:00Z") };
  const connected = options?.connected ?? true;
  const users: UserRepository = {
    findByEmail: vi.fn(),
    findOrCreateByEmail: vi.fn(),
    findById: vi.fn(async () => ({
      id: TEST_USER_ID,
      email: "paul@example.com",
      gmailConnected: connected,
      gmailRefreshToken: connected ? "enc:token" : null,
      gmailHistoryId: options?.historyId ?? "10",
    })),
    create: vi.fn(),
    updateGmailConnection: vi.fn(async () => undefined),
    updateHistoryId: vi.fn(async () => undefined),
    listConnectedUserIds: vi.fn(async () => (connected ? [TEST_USER_ID] : [])),
  };

  const pipeline = new SubscriptionPipelineService({
    users,
    subscriptions,
    processedEmails,
    notifications,
    snapshots,
    vendorAliases,
    gmail,
    extractor: new FixtureExtractor(extractionBySubject),
    encryptor,
    clock,
    autoApplyThreshold: AUTO_APPLY_THRESHOLD,
    fuzzyThreshold: FUZZY_THRESHOLD,
    snapshotTtlDays: 30,
  });

  const sync = new GmailSyncService(
    users,
    processedEmails,
    gmail,
    encryptor,
    pipeline,
    notifications,
    {
      record: vi.fn(async (input) => {
        auditRows.push({
          id: `${auditRows.length}`,
          userId: input.userId,
          action: input.action,
          actor: input.actor,
          details: input.details,
          createdAt: new Date(),
        });
      }),
      listByUser: vi.fn(async (userId) => auditRows.filter((row) => row.userId === userId)),
      purgeOlderThan: vi.fn(async () => 0),
    },
    clock,
    12,
    500,
  );

  const alerts = new AlertJobs(users, subscriptions, notifications, snapshots, {
    record: async (input) => {
      auditRows.push({
        id: `${auditRows.length}`,
        userId: input.userId,
        action: input.action,
        actor: input.actor,
        details: input.details,
        createdAt: new Date(),
      });
    },
    listByUser: async (userId) => auditRows.filter((row) => row.userId === userId),
    purgeOlderThan: async () => 0,
  }, clock, 30, 2, 180);

  return { pipeline, sync, alerts, subscriptions, processedEmails, notifications, gmail, users, snapshots, auditRows };
}
