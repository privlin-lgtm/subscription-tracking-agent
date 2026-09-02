function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const appConfig = {
  authSecret: process.env.AUTH_SECRET ?? "dev-only-secret-change-me",
  authUrl: process.env.AUTH_URL ?? "http://localhost:3000",
  databaseUrl: process.env.DATABASE_URL ?? "",
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  gmailRedirectUri:
    process.env.GMAIL_OAUTH_REDIRECT_URI ?? "http://localhost:3000/api/gmail/callback",
  tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY ?? "",
  llm: {
    baseUrl: process.env.LLM_BASE_URL ?? "https://api.openai.com/v1",
    apiKey: process.env.LLM_API_KEY ?? "",
    model: process.env.LLM_MODEL ?? "gpt-4o-mini",
  },
  confidenceAutoApplyThreshold: numberEnv("CONFIDENCE_AUTO_APPLY_THRESHOLD", 0.85),
  vendorFuzzyMatchThreshold: numberEnv("VENDOR_FUZZY_MATCH_THRESHOLD", 0.88),
  emailSnapshotTtlDays: numberEnv("EMAIL_SNAPSHOT_TTL_DAYS", 30),
  inactivityGraceCycles: numberEnv("INACTIVITY_GRACE_CYCLES", 2),
  auditLogRetentionDays: numberEnv("AUDIT_LOG_RETENTION_DAYS", 180),
  renewalReminderDays: numberEnv("RENEWAL_REMINDER_DAYS", 7),
  gmailLookbackMonths: numberEnv("GMAIL_LOOKBACK_MONTHS", 12),
  gmailMaxLookbackMessages: numberEnv("GMAIL_MAX_LOOKBACK_MESSAGES", 500),
  gmailMaxRetries: numberEnv("GMAIL_MAX_RETRIES", 5),
};
