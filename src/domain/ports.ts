export type GmailMessageMeta = {
  id: string;
  historyId: string;
  threadId: string;
  subject: string;
  sender: string;
  snippet: string;
};

export type GmailMessage = GmailMessageMeta & {
  bodyText: string;
  internalDate: Date;
};

export type HistorySyncResult = {
  messageIds: string[];
  latestHistoryId: string;
  expired: boolean;
};

export interface GmailClient {
  listHistory(refreshToken: string, startHistoryId: string): Promise<HistorySyncResult>;
  listRelevantMessages(refreshToken: string, after: Date, maxResults: number): Promise<string[]>;
  getMetadata(refreshToken: string, messageId: string): Promise<GmailMessageMeta>;
  getMessage(refreshToken: string, messageId: string): Promise<GmailMessage>;
  getProfileHistoryId(refreshToken: string): Promise<string>;
  revokeRefreshToken(refreshToken: string): Promise<void>;
}

export type ExtractionInput = {
  subject: string;
  sender: string;
  bodyText: string;
};

export type ExtractionResult = {
  isSubscription: boolean;
  vendor: string;
  priceAmount: number;
  currency: string;
  billingCycle: "weekly" | "monthly" | "annual" | "custom" | "unknown";
  renewalDate: Date | null;
  confidence: number;
};

export interface ExtractionAgent {
  extract(input: ExtractionInput): Promise<ExtractionResult>;
}

export interface TokenEncryptor {
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string;
}

export interface Clock {
  now(): Date;
}

export interface JobLock {
  withUserLock<T>(userId: string, fn: () => Promise<T>): Promise<T | null>;
}

export type Actor = "system" | "user";
