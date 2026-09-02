import { describe, expect, it } from "vitest";
import { passesSubscriptionPrefilter } from "@/application/gmail/gmail-prefilter";

describe("gmail prefilter", () => {
  it("keeps known billing senders", () => {
    expect(
      passesSubscriptionPrefilter({
        subject: "Hello",
        sender: "info@netflix.com",
        snippet: "thanks for watching",
      }),
    ).toBe(true);
  });

  it("keeps keyword matches from unknown senders", () => {
    expect(
      passesSubscriptionPrefilter({
        subject: "Your receipt for May",
        sender: "billing@example.dev",
        snippet: "subscription renewed",
      }),
    ).toBe(true);
  });

  it("drops unrelated mail before the LLM", () => {
    expect(
      passesSubscriptionPrefilter({
        subject: "Lunch tomorrow?",
        sender: "friend@gmail.com",
        snippet: "see you at noon",
      }),
    ).toBe(false);
  });

  it("keeps invoices, memberships, and trial-end notices", () => {
    expect(
      passesSubscriptionPrefilter({
        subject: "Invoice #4421",
        sender: "billing@vendor.dev",
        snippet: "amount due",
      }),
    ).toBe(true);
    expect(
      passesSubscriptionPrefilter({
        subject: "Membership canceled",
        sender: "hello@club.dev",
        snippet: "your membership",
      }),
    ).toBe(true);
    expect(
      passesSubscriptionPrefilter({
        subject: "Your trial ends tomorrow",
        sender: "no-reply@app.dev",
        snippet: "trial ends",
      }),
    ).toBe(true);
  });
});
