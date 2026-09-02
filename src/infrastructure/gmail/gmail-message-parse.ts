import type { GmailMessage, GmailMessageMeta } from "@/domain/ports";

export type GmailPayload = {
  mimeType?: string | null;
  body?: { data?: string | null };
  parts?: unknown[];
  headers?: Array<{ name?: string | null; value?: string | null }>;
};

export type GmailApiMessage = {
  id?: string | null;
  historyId?: string | null;
  threadId?: string | null;
  snippet?: string | null;
  internalDate?: string | null;
  payload?: GmailPayload;
};

export function decodeGmailBody(payload: GmailPayload | undefined): string {
  if (!payload) {
    return "";
  }
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, "base64url").toString("utf8");
  }
  const parts = (payload.parts ?? []) as GmailPayload[];
  const textPart = parts.find((part) => part.mimeType === "text/plain") ?? parts[0];
  if (textPart?.body?.data) {
    return Buffer.from(textPart.body.data, "base64url").toString("utf8");
  }
  return parts.map((part) => decodeGmailBody(part)).join("\n");
}

export function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function gmailHeaderValue(
  headers: Array<{ name?: string | null; value?: string | null }> | undefined,
  name: string,
): string {
  return headers?.find((item) => item.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

export function parseGmailMetadata(data: GmailApiMessage, fallbackId: string): GmailMessageMeta {
  return {
    id: data.id ?? fallbackId,
    historyId: data.historyId ?? "",
    threadId: data.threadId ?? "",
    subject: gmailHeaderValue(data.payload?.headers, "subject"),
    sender: gmailHeaderValue(data.payload?.headers, "from"),
    snippet: data.snippet ?? "",
  };
}

export function parseGmailFullMessage(data: GmailApiMessage, fallbackId: string): GmailMessage {
  const rawBody = decodeGmailBody(data.payload);
  return {
    ...parseGmailMetadata(data, fallbackId),
    bodyText: stripHtml(rawBody).slice(0, 12_000),
    internalDate: new Date(Number(data.internalDate ?? Date.now())),
  };
}
