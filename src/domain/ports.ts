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
  isCancellation: boolean;
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

/**
 * One published FX rate: 1 unit of `base` = `rate` units of `quote`, as of `rateDate`
 * (a calendar day, "YYYY-MM-DD", exactly as the provider published it).
 */
export type FxRate = {
  base: string;
  quote: string;
  rate: number;
  rateDate: string;
  source: string;
};

export interface FxRateProvider {
  /** Short stable identifier stored with each rate and shown next to converted totals. */
  readonly source: string;
  /**
   * Latest rates for `base` against each of `quotes`. Receives currency codes only — never
   * user data. May return fewer rows than requested (a currency the provider doesn't cover).
   */
  fetchLatest(base: string, quotes: string[]): Promise<FxRate[]>;
}
