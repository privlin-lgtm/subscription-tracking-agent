import { describe, expect, it } from "vitest";
import { buildRelevantGmailQuery } from "@/application/gmail/relevant-query";

describe("relevant gmail query", () => {
  it("limits lookback to subscription keywords and known billing senders", () => {
    const query = buildRelevantGmailQuery(new Date("2026-01-01T00:00:00Z"));
    expect(query).toContain("after:1767225600");
    expect(query).toContain("subject:(subscription OR renewal");
    expect(query).toContain('"payment confirmation"');
    expect(query).toContain("from:netflix.com");
    expect(query.startsWith("after:1767225600 ")).toBe(true);
  });
});
