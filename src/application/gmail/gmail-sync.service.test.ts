import { EmailClassification } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { GmailAuthError } from "@/domain/errors";
import type { Clock, GmailClient, GmailMessage, GmailMessageMeta, HistorySyncResult, TokenEncryptor } from "@/domain/ports";
import type { AuditRepository, NotificationRepository, ProcessedEmailRepository, UserRepository } from "@/domain/repositories";
import { GmailSyncService } from "@/application/gmail/gmail-sync.service";
import type { SubscriptionPipelineService } from "@/application/subscriptions/subscription-pipeline.service";

const USER_ID = "user_1";

function messageMeta(overrides: Partial<GmailMessageMeta> = {}): GmailMessageMeta {
  return {
    id: "msg_1",
    historyId: "99",
    threadId: "t1",
    subject: "Your Netflix receipt",
    sender: "info@netflix.com",
    snippet: "subscription renewed",
    ...overrides,
  };
}

function fullMessage(overrides: Partial<GmailMessage> = {}): GmailMessage {
  return {
    ...messageMeta(),
    bodyText: "You were billed $15.49",
    internalDate: new Date("2026-09-01"),
    ...overrides,
  };
}

function createHarness(options?: {
  historyId?: string | null;
  history?: HistorySyncResult;
  metadata?: GmailMessageMeta[];
  alreadyProcessed?: string[];
  listRelevant?: string[];
  failAuth?: boolean;
}) {
  const processed = new Set(options?.alreadyProcessed ?? []);
  const fullGets: string[] = [];
  const metaGets: string[] = [];
  const users: UserRepository = {
    findByEmail: vi.fn(),
    findOrCreateByEmail: vi.fn(),
    findById: vi.fn(async () => ({
      id: USER_ID,
      email: "paul@example.com",
      gmailConnected: true,
      gmailRefreshToken: "enc:token",
      gmailHistoryId: options?.historyId ?? "10",
    })),
    create: vi.fn(),
    updateGmailConnection: vi.fn(async () => undefined),
    updateHistoryId: vi.fn(async () => undefined),
    listConnectedUserIds: vi.fn(async () => [USER_ID]),
  };
  const processedEmails: ProcessedEmailRepository = {
    exists: vi.fn(async (_userId, id) => processed.has(id)),
    record: vi.fn(async (input) => {
      processed.add(input.gmailMessageId);
    }),
  };
  const gmail: GmailClient = {
    listHistory: vi.fn(async () => options?.history ?? { messageIds: ["msg_1"], latestHistoryId: "20", expired: false }),
    listRelevantMessages: vi.fn(async () => options?.listRelevant ?? ["msg_lookback"]),
    getMetadata: vi.fn(async (_token, id) => {
      metaGets.push(id);
      return options?.metadata?.find((item) => item.id === id) ?? messageMeta({ id });
    }),
    getMessage: vi.fn(async (_token, id) => {
      if (options?.failAuth) {
        throw new GmailAuthError();
      }
      fullGets.push(id);
      return fullMessage({ id });
    }),
    getProfileHistoryId: vi.fn(async () => "50"),
    revokeRefreshToken: vi.fn(async () => undefined),
  };
  const encryptor: TokenEncryptor = {
    encrypt: (value) => `enc:${value}`,
    decrypt: (value) => value.replace(/^enc:/, ""),
  };
  const pipeline = {
    processMessage: vi.fn(async () => undefined),
  } as unknown as SubscriptionPipelineService;
  const notifications: NotificationRepository = {
    createIfAbsent: vi.fn(async () => true),
    listByUser: vi.fn(async () => []),
    markRead: vi.fn(async () => undefined),
  };
  const audit: AuditRepository = {
    record: vi.fn(async () => undefined),
    listByUser: vi.fn(async () => []),
  };
  const clock: Clock = { now: () => new Date("2026-09-02T00:00:00Z") };

  const service = new GmailSyncService(
    users,
    processedEmails,
    gmail,
    encryptor,
    pipeline,
    notifications,
    audit,
    clock,
    12,
    500,
  );

  return { service, users, processedEmails, gmail, pipeline, notifications, fullGets, metaGets };
}

describe("gmail sync service", () => {
  it("uses incremental history and only fetches full bodies for relevant mail", async () => {
    const harness = createHarness({
      history: { messageIds: ["keep", "drop"], latestHistoryId: "21", expired: false },
      metadata: [
        messageMeta({ id: "keep", subject: "Your receipt", snippet: "subscription renewed" }),
        messageMeta({ id: "drop", subject: "Lunch", sender: "friend@gmail.com", snippet: "see you" }),
      ],
    });

    const result = await harness.service.syncUser(USER_ID);

    expect(result).toEqual({ processed: 1, skipped: 1 });
    expect(harness.fullGets).toEqual(["keep"]);
    expect(harness.pipeline.processMessage).toHaveBeenCalledTimes(1);
    expect(harness.users.updateHistoryId).toHaveBeenCalledWith(USER_ID, "21");
    expect(harness.processedEmails.record).toHaveBeenCalledWith(
      expect.objectContaining({ gmailMessageId: "drop", classification: EmailClassification.NOT_SUBSCRIPTION }),
    );
  });

  it("falls back to a bounded relevant-message lookback when historyId expired", async () => {
    const harness = createHarness({
      history: { messageIds: [], latestHistoryId: "10", expired: true },
      listRelevant: ["msg_new"],
      metadata: [messageMeta({ id: "msg_new" })],
    });

    await harness.service.syncUser(USER_ID);

    expect(harness.gmail.listRelevantMessages).toHaveBeenCalled();
    expect(harness.gmail.getProfileHistoryId).toHaveBeenCalled();
    expect(harness.users.updateHistoryId).toHaveBeenCalledWith(USER_ID, "50");
  });

  it("skips messages already in the processed-email ledger", async () => {
    const harness = createHarness({
      alreadyProcessed: ["msg_1"],
      history: { messageIds: ["msg_1"], latestHistoryId: "22", expired: false },
    });

    const result = await harness.service.syncUser(USER_ID);
    expect(result.skipped).toBe(1);
    expect(harness.gmail.getMetadata).not.toHaveBeenCalled();
    expect(harness.fullGets).toEqual([]);
  });

  it("clears stored tokens when Gmail reports an auth failure", async () => {
    const harness = createHarness({ failAuth: true });
    const result = await harness.service.syncUser(USER_ID);
    expect(result.disconnected).toBe(true);
    expect(harness.users.updateGmailConnection).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ gmailConnected: false, gmailRefreshToken: null }),
    );
    expect(harness.notifications.createIfAbsent).toHaveBeenCalled();
  });
});
