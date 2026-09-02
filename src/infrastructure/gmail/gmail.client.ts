import { google } from "googleapis";
import { appConfig } from "@/shared/config";
import type { GmailClient, GmailMessage, HistorySyncResult } from "@/domain/ports";

export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

export function createGoogleOAuthClient() {
  return new google.auth.OAuth2(
    appConfig.googleClientId,
    appConfig.googleClientSecret,
    appConfig.gmailRedirectUri,
  );
}

export function buildGmailAuthUrl(state: string): string {
  const client = createGoogleOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [GMAIL_READONLY_SCOPE],
    state,
    include_granted_scopes: false,
  });
}

export async function exchangeGmailCode(code: string): Promise<string> {
  const client = createGoogleOAuthClient();
  const { tokens } = await client.getToken(code);
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

function decodeBody(payload: { body?: { data?: string | null }; parts?: unknown[] } | undefined): string {
  if (!payload) {
    return "";
  }
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, "base64url").toString("utf8");
  }
  const parts = (payload.parts ?? []) as Array<{ mimeType?: string; body?: { data?: string }; parts?: unknown[] }>;
  const textPart = parts.find((part) => part.mimeType === "text/plain") ?? parts[0];
  if (textPart?.body?.data) {
    return Buffer.from(textPart.body.data, "base64url").toString("utf8");
  }
  return parts.map((part) => decodeBody(part)).join("\n");
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export class GoogleGmailClient implements GmailClient {
  async listHistory(refreshToken: string, startHistoryId: string): Promise<HistorySyncResult> {
    const gmail = gmailApi(refreshToken);
    try {
      const response = await gmail.users.history.list({
        userId: "me",
        startHistoryId,
        historyTypes: ["messageAdded"],
      });
      const messageIds = [
        ...new Set(
          (response.data.history ?? []).flatMap((entry) =>
            (entry.messagesAdded ?? []).map((added) => added.message?.id).filter((id): id is string => Boolean(id)),
          ),
        ),
      ];
      return {
        messageIds,
        latestHistoryId: response.data.historyId ?? startHistoryId,
        expired: false,
      };
    } catch (error) {
      const status = (error as { code?: number }).code;
      if (status === 404) {
        return { messageIds: [], latestHistoryId: startHistoryId, expired: true };
      }
      throw error;
    }
  }

  async listMessagesLookback(refreshToken: string, after: Date): Promise<string[]> {
    const gmail = gmailApi(refreshToken);
    const afterEpoch = Math.floor(after.getTime() / 1000);
    const response = await gmail.users.messages.list({
      userId: "me",
      q: `after:${afterEpoch}`,
      maxResults: 100,
    });
    return (response.data.messages ?? []).map((message) => message.id).filter((id): id is string => Boolean(id));
  }

  async getMessage(refreshToken: string, messageId: string): Promise<GmailMessage> {
    const gmail = gmailApi(refreshToken);
    const response = await gmail.users.messages.get({
      userId: "me",
      id: messageId,
      format: "full",
    });
    const headers = response.data.payload?.headers ?? [];
    const header = (name: string) => headers.find((item) => item.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
    const rawBody = decodeBody(response.data.payload);
    return {
      id: response.data.id ?? messageId,
      historyId: response.data.historyId ?? "",
      threadId: response.data.threadId ?? "",
      subject: header("subject"),
      sender: header("from"),
      snippet: response.data.snippet ?? "",
      bodyText: stripHtml(rawBody).slice(0, 12_000),
      internalDate: new Date(Number(response.data.internalDate ?? Date.now())),
    };
  }
}
