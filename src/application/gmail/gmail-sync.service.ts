import { EmailClassification } from "@prisma/client";
import { GmailAuthError, NotFoundError, ValidationError } from "@/domain/errors";
import type { Clock, GmailClient, GmailMessage, TokenEncryptor } from "@/domain/ports";
import type {
  AuditRepository,
  NotificationRepository,
  ProcessedEmailRepository,
  UserRepository,
} from "@/domain/repositories";
import { passesSubscriptionPrefilter } from "@/application/gmail/gmail-prefilter";
import { SubscriptionPipelineService } from "@/application/subscriptions/subscription-pipeline.service";

export type GmailSyncResult = {
  processed: number;
  skipped: number;
  disconnected?: boolean;
};

export class GmailSyncService {
  constructor(
    private readonly users: UserRepository,
    private readonly processedEmails: ProcessedEmailRepository,
    private readonly gmail: GmailClient,
    private readonly encryptor: TokenEncryptor,
    private readonly pipeline: SubscriptionPipelineService,
    private readonly notifications: NotificationRepository,
    private readonly audit: AuditRepository,
    private readonly clock: Clock,
    private readonly lookbackMonths: number,
    private readonly maxLookbackMessages: number,
  ) {}

  async connect(userId: string, refreshToken: string): Promise<void> {
    const encrypted = this.encryptor.encrypt(refreshToken);
    const historyId = await this.gmail.getProfileHistoryId(refreshToken);
    await this.users.updateGmailConnection(userId, {
      gmailRefreshToken: encrypted,
      gmailConnected: true,
      gmailHistoryId: historyId,
      gmailDisconnectedAt: null,
    });
    await this.audit.record({
      userId,
      action: "gmail.connect",
      actor: "user",
      details: { scope: "gmail.readonly" },
    });
  }

  async disconnect(userId: string): Promise<void> {
    const user = await this.users.findById(userId);
    if (user?.gmailRefreshToken) {
      try {
        await this.gmail.revokeRefreshToken(this.encryptor.decrypt(user.gmailRefreshToken));
      } catch {
        // Already revoked or unreachable; still clear local credentials.
      }
    }
    await this.markDisconnected(userId);
  }

  async syncUser(userId: string): Promise<GmailSyncResult> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new NotFoundError("User", userId);
    }
    if (!user.gmailConnected || !user.gmailRefreshToken) {
      throw new ValidationError("Gmail is not connected");
    }

    const refreshToken = this.encryptor.decrypt(user.gmailRefreshToken);

    try {
      const { messageIds, checkpoint } = await this.collectMessageIds(refreshToken, user.gmailHistoryId);
      let processed = 0;
      let skipped = 0;

      for (const messageId of messageIds) {
        const result = await this.processOne(userId, refreshToken, messageId, checkpoint);
        if (result === "processed") {
          processed += 1;
        } else {
          skipped += 1;
        }
      }

      if (checkpoint) {
        await this.users.updateHistoryId(userId, checkpoint);
      }

      await this.audit.record({
        userId,
        action: "gmail.sync",
        actor: "system",
        details: { processed, skipped },
      });

      return { processed, skipped };
    } catch (error) {
      if (error instanceof GmailAuthError) {
        await this.markDisconnected(userId);
        return { processed: 0, skipped: 0, disconnected: true };
      }
      throw error;
    }
  }

  async markDisconnected(userId: string): Promise<void> {
    await this.users.updateGmailConnection(userId, {
      gmailConnected: false,
      gmailRefreshToken: null,
      gmailHistoryId: null,
      gmailDisconnectedAt: this.clock.now(),
    });
    await this.notifications.createIfAbsent({
      userId,
      type: "GMAIL_DISCONNECTED",
      title: "Gmail disconnected",
      body: "Reconnect Gmail to resume subscription scanning.",
      idempotencyKey: `gmail-disconnected:${userId}:${this.clock.now().toISOString().slice(0, 10)}`,
    });
    await this.audit.record({
      userId,
      action: "gmail.disconnect",
      actor: "system",
      details: {},
    });
  }

  private async collectMessageIds(
    refreshToken: string,
    storedHistoryId: string | null,
  ): Promise<{ messageIds: string[]; checkpoint: string }> {
    if (storedHistoryId) {
      const history = await this.gmail.listHistory(refreshToken, storedHistoryId);
      if (!history.expired) {
        return { messageIds: history.messageIds, checkpoint: history.latestHistoryId };
      }
    }

    const after = new Date(this.clock.now());
    after.setMonth(after.getMonth() - this.lookbackMonths);
    const messageIds = await this.gmail.listRelevantMessages(refreshToken, after, this.maxLookbackMessages);
    const checkpoint = await this.gmail.getProfileHistoryId(refreshToken);
    return { messageIds, checkpoint };
  }

  private async processOne(
    userId: string,
    refreshToken: string,
    messageId: string,
    historyId: string,
  ): Promise<"processed" | "skipped"> {
    if (await this.processedEmails.exists(userId, messageId)) {
      return "skipped";
    }

    const metadata = await this.gmail.getMetadata(refreshToken, messageId);
    if (
      !passesSubscriptionPrefilter({
        subject: metadata.subject,
        sender: metadata.sender,
        snippet: metadata.snippet,
      })
    ) {
      await this.processedEmails.record({
        userId,
        gmailMessageId: messageId,
        gmailHistoryId: historyId,
        classification: EmailClassification.NOT_SUBSCRIPTION,
      });
      return "skipped";
    }

    const message: GmailMessage = await this.gmail.getMessage(refreshToken, messageId);
    await this.pipeline.processMessage(userId, message, historyId);
    return "processed";
  }
}
