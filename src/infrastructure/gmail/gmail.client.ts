import { google } from "googleapis";
import { CodeChallengeMethod } from "google-auth-library";
import { appConfig } from "@/shared/config";
import { GmailAuthError } from "@/domain/errors";
import { classifyGmailError } from "@/infrastructure/gmail/gmail-errors";
import { withGmailRetries } from "@/infrastructure/gmail/rate-limit";
import { buildRelevantGmailQuery } from "@/application/gmail/relevant-query";
import { parseGmailFullMessage, parseGmailMetadata } from "@/infrastructure/gmail/gmail-message-parse";
import type { GmailClient, GmailMessage, GmailMessageMeta, HistorySyncResult } from "@/domain/ports";

export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const GMAIL_PKCE_COOKIE = "gmail_oauth_pkce";

export function createGoogleOAuthClient() {
  return new google.auth.OAuth2(
    appConfig.googleClientId,
    appConfig.googleClientSecret,
    appConfig.gmailRedirectUri,
  );
}

export function buildGmailAuthUrl(state: string, codeChallenge: string): string {
  const client = createGoogleOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [GMAIL_READONLY_SCOPE],
    state,
    include_granted_scopes: false,
    code_challenge: codeChallenge,
    code_challenge_method: CodeChallengeMethod.S256,
  });
}

export async function exchangeGmailCode(code: string, codeVerifier: string): Promise<string> {
  const client = createGoogleOAuthClient();
  const { tokens } = await client.getToken({
    code,
    codeVerifier,
  });
  if (!tokens.refresh_token) {
    throw new Error("Google did not return a refresh token");
  }
  return tokens.refresh_token;
}

function gmailApi(refreshToken: string) {
  const auth = createGoogleOAuthClient();
  auth.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: "v1", auth });
}

async function gmailCall<T>(fn: () => Promise<T>): Promise<T> {
  return withGmailRetries(fn, { maxAttempts: appConfig.gmailMaxRetries });
}

export class GoogleGmailClient implements GmailClient {
  async listHistory(refreshToken: string, startHistoryId: string): Promise<HistorySyncResult> {
    const gmail = gmailApi(refreshToken);
    const messageIds = new Set<string>();
    let pageToken: string | undefined;
    let latestHistoryId = startHistoryId;

    try {
      do {
        const token = pageToken;
        const response = await gmailCall(() =>
          gmail.users.history.list({
            userId: "me",
            startHistoryId,
            historyTypes: ["messageAdded"],
            pageToken: token,
            maxResults: 500,
          }),
        );
        for (const entry of response.data.history ?? []) {
          for (const added of entry.messagesAdded ?? []) {
            if (added.message?.id) {
              messageIds.add(added.message.id);
            }
          }
        }
        latestHistoryId = response.data.historyId ?? latestHistoryId;
        pageToken = response.data.nextPageToken ?? undefined;
      } while (pageToken);

      return { messageIds: [...messageIds], latestHistoryId, expired: false };
    } catch (error) {
      if (classifyGmailError(error) === "history_expired") {
        return { messageIds: [], latestHistoryId: startHistoryId, expired: true };
      }
      if (classifyGmailError(error) === "auth") {
        throw new GmailAuthError();
      }
      throw error;
    }
  }

  async listRelevantMessages(refreshToken: string, after: Date, maxResults: number): Promise<string[]> {
    const gmail = gmailApi(refreshToken);
    const ids: string[] = [];
    let pageToken: string | undefined;
    const query = buildRelevantGmailQuery(after);

    do {
      const token = pageToken;
      const remaining = maxResults - ids.length;
      const response = await gmailCall(() =>
        gmail.users.messages.list({
          userId: "me",
          q: query,
          maxResults: Math.min(100, remaining),
          pageToken: token,
        }),
      );
      for (const message of response.data.messages ?? []) {
        if (message.id) {
          ids.push(message.id);
        }
        if (ids.length >= maxResults) {
          return ids;
        }
      }
      pageToken = response.data.nextPageToken ?? undefined;
    } while (pageToken);

    return ids;
  }

  async getMetadata(refreshToken: string, messageId: string): Promise<GmailMessageMeta> {
    const gmail = gmailApi(refreshToken);
    const response = await gmailCall(() =>
      gmail.users.messages.get({
        userId: "me",
        id: messageId,
        format: "metadata",
        metadataHeaders: ["Subject", "From"],
      }),
    );
    return parseGmailMetadata(response.data, messageId);
  }

  async getMessage(refreshToken: string, messageId: string): Promise<GmailMessage> {
    const gmail = gmailApi(refreshToken);
    const response = await gmailCall(() =>
      gmail.users.messages.get({
        userId: "me",
        id: messageId,
        format: "full",
      }),
    );
    return parseGmailFullMessage(response.data, messageId);
  }

  async getProfileHistoryId(refreshToken: string): Promise<string> {
    const gmail = gmailApi(refreshToken);
    const response = await gmailCall(() => gmail.users.getProfile({ userId: "me" }));
    if (!response.data.historyId) {
      throw new Error("Gmail profile did not include a historyId");
    }
    return response.data.historyId;
  }

  async revokeRefreshToken(refreshToken: string): Promise<void> {
    const client = createGoogleOAuthClient();
    try {
      await gmailCall(() => client.revokeToken(refreshToken));
    } catch (error) {
      if (classifyGmailError(error) === "auth") {
        return;
      }
      throw error;
    }
  }
}
