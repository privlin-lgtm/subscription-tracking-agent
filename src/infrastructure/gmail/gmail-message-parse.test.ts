import { describe, expect, it } from "vitest";
import {
  decodeGmailBody,
  gmailHeaderValue,
  parseGmailFullMessage,
  parseGmailMetadata,
  stripHtml,
} from "@/infrastructure/gmail/gmail-message-parse";

function b64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

describe("gmail message parsing", () => {
  it("decodes a simple base64url text body", () => {
    expect(decodeGmailBody({ body: { data: b64("You were billed $15.49") } })).toBe("You were billed $15.49");
  });

  it("prefers the text/plain part in a multipart payload", () => {
    const body = decodeGmailBody({
      parts: [
        { mimeType: "text/html", body: { data: b64("<p>HTML billed</p>") } },
        { mimeType: "text/plain", body: { data: b64("Plain billed $9.99") } },
      ],
    });
    expect(body).toBe("Plain billed $9.99");
  });

  it("walks nested multipart parts when the body is not on the root", () => {
    const body = decodeGmailBody({
      parts: [
        {
          mimeType: "multipart/alternative",
          parts: [{ mimeType: "text/plain", body: { data: b64("Nested receipt") } }],
        },
      ],
    });
    expect(body).toContain("Nested receipt");
  });

  it("strips HTML and collapses whitespace", () => {
    expect(stripHtml("<h1>Netflix</h1>\n<p>You were  billed&nbsp;</p>")).toBe("Netflix You were billed&nbsp;");
  });

  it("reads headers case-insensitively", () => {
    expect(gmailHeaderValue([{ name: "Subject", value: "Your receipt" }], "subject")).toBe("Your receipt");
    expect(gmailHeaderValue([], "from")).toBe("");
  });

  it("maps a Gmail API payload into metadata and a full message", () => {
    const payload = {
      id: "msg_1",
      historyId: "22",
      threadId: "t1",
      snippet: "subscription renewed",
      internalDate: "1756771200000",
      payload: {
        headers: [
          { name: "Subject", value: "Your Netflix receipt" },
          { name: "From", value: "info@netflix.com" },
        ],
        body: { data: b64("<b>Billed</b> $15.49") },
      },
    };
    expect(parseGmailMetadata(payload, "fallback")).toMatchObject({
      id: "msg_1",
      subject: "Your Netflix receipt",
      sender: "info@netflix.com",
    });
    const full = parseGmailFullMessage(payload, "fallback");
    expect(full.bodyText).toBe("Billed $15.49");
    expect(full.internalDate.toISOString()).toBe(new Date(1756771200000).toISOString());
  });
});
