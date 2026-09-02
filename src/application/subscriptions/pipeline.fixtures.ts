import type { ExtractionResult } from "@/domain/ports";
import type { GmailMessage } from "@/domain/ports";

export type PipelineFixture = {
  name: string;
  message: GmailMessage;
  extraction: ExtractionResult | "extraction_failure";
};

function message(overrides: Partial<GmailMessage> & { id: string }): GmailMessage {
  return {
    historyId: "1",
    threadId: `thread_${overrides.id}`,
    subject: "Receipt",
    sender: "billing@example.com",
    snippet: "receipt",
    bodyText: "",
    internalDate: new Date("2026-09-01"),
    ...overrides,
  };
}

function extraction(overrides: Partial<ExtractionResult> = {}): ExtractionResult {
  return {
    isSubscription: true,
    isCancellation: false,
    vendor: "Netflix",
    priceAmount: 15.49,
    currency: "USD",
    billingCycle: "monthly",
    renewalDate: new Date("2026-10-01"),
    confidence: 0.95,
    ...overrides,
  };
}

/** First-ever receipt for a vendor: pipeline should create a new ACTIVE subscription. */
export const NEW_SUBSCRIPTION: PipelineFixture = {
  name: "new_subscription",
  message: message({
    id: "msg_new",
    subject: "Your Netflix subscription is confirmed",
    sender: "info@netflix.com",
    snippet: "subscription confirmed, billed monthly",
    bodyText: "Thanks for subscribing to Netflix. You were billed $15.49 today, renews 2026-10-01.",
  }),
  extraction: extraction(),
};

/** Same vendor/price, later renewal date: should update the existing record and log RENEWED. */
export const RENEWAL: PipelineFixture = {
  name: "renewal",
  message: message({
    id: "msg_renewal",
    subject: "Your Netflix receipt",
    sender: "info@netflix.com",
    snippet: "payment confirmation",
    bodyText: "You were billed $15.49 today, renews 2026-11-01.",
  }),
  extraction: extraction({ renewalDate: new Date("2026-11-01") }),
};

/** Same vendor, higher price: should log PRICE_CHANGED, record a PriceChange row, and notify. */
export const PRICE_INCREASE: PipelineFixture = {
  name: "price_increase",
  message: message({
    id: "msg_price_increase",
    subject: "Your Netflix receipt",
    sender: "info@netflix.com",
    snippet: "payment confirmation, your plan price has changed",
    bodyText: "Your plan price changed. You were billed $19.99 today, renews 2026-11-01.",
  }),
  extraction: extraction({ priceAmount: 19.99, renewalDate: new Date("2026-11-01") }),
};

/** Same vendor/price/period as an existing record: should be a silent no-op (duplicate receipt). */
export const DUPLICATE_RECEIPT: PipelineFixture = {
  name: "duplicate_receipt",
  message: message({
    id: "msg_duplicate",
    subject: "Your Netflix receipt (forwarded)",
    sender: "info@netflix.com",
    snippet: "payment confirmation",
    bodyText: "You were billed $15.49 today, renews 2026-10-01.",
  }),
  extraction: extraction(),
};

/**
 * Same vendor as an existing USD subscription, but this receipt is billed in EUR
 * (e.g. the vendor changed billing region). Must never auto-merge across currencies.
 */
export const CURRENCY_SWITCH: PipelineFixture = {
  name: "currency_switch",
  message: message({
    id: "msg_currency_switch",
    subject: "Your Netflix receipt",
    sender: "info@netflix.com",
    snippet: "payment confirmation",
    bodyText: "You were billed EUR 14.99 today, renews 2026-11-01.",
  }),
  extraction: extraction({ priceAmount: 14.99, currency: "EUR", renewalDate: new Date("2026-11-01") }),
};

/** Ambiguous trial-upgrade email the model is unsure about: must be held for manual review, never auto-applied. */
export const LOW_CONFIDENCE_TRIAL: PipelineFixture = {
  name: "low_confidence_trial",
  message: message({
    id: "msg_trial",
    subject: "Your trial is ending soon",
    sender: "no-reply@unknownvendor.io",
    snippet: "trial ends, choose a plan",
    bodyText: "Your trial ends soon. Pricing may vary by plan.",
  }),
  extraction: extraction({
    vendor: "Unknown Vendor",
    priceAmount: 9.99,
    currency: "USD",
    renewalDate: null,
    billingCycle: "unknown",
    confidence: 0.4,
  }),
};

/** Ordinary non-billing mail: must be dropped by the prefilter before ever reaching the LLM. */
export const NOT_SUBSCRIPTION: PipelineFixture = {
  name: "not_subscription",
  message: message({
    id: "msg_newsletter",
    subject: "This week in tech",
    sender: "digest@newsletter.example",
    snippet: "top stories this week",
    bodyText: "Here are this week's top stories.",
  }),
  extraction: extraction({ isSubscription: false }),
};

/** A clear, high-confidence cancellation confirmation from a known billing domain: should auto-cancel the matching ACTIVE subscription. */
export const CANCELLATION_CONFIRMED: PipelineFixture = {
  name: "cancellation_confirmed",
  message: message({
    id: "msg_cancellation",
    subject: "Your Netflix membership has been canceled",
    sender: "info@netflix.com",
    snippet: "membership canceled, no further charges",
    bodyText: "Your Netflix membership has been canceled. You will not be billed again.",
  }),
  extraction: extraction({
    isCancellation: true,
    priceAmount: 0,
    currency: "USD",
    renewalDate: null,
    billingCycle: "unknown",
    confidence: 0.9,
  }),
};

/** A vague, low-confidence cancellation-like signal from an unfamiliar sender: should flag the existing subscription for review, not auto-cancel it. */
export const CANCELLATION_AMBIGUOUS: PipelineFixture = {
  name: "cancellation_ambiguous",
  message: message({
    id: "msg_cancellation_ambiguous",
    subject: "Update to your Netflix subscription",
    sender: "no-reply@mailer.example",
    snippet: "billing information update",
    bodyText: "There have been some changes to your account and billing.",
  }),
  extraction: extraction({
    isCancellation: true,
    priceAmount: 0,
    currency: "USD",
    renewalDate: null,
    billingCycle: "unknown",
    confidence: 0.5,
  }),
};

/** The LLM call itself fails (timeout, malformed JSON after repair retry): must fail safe into review, not drop the email. */
export const EXTRACTION_FAILURE: PipelineFixture = {
  name: "extraction_failure",
  message: message({
    id: "msg_extraction_failure",
    subject: "Your subscription receipt",
    sender: "billing@vendorx.com",
    snippet: "payment confirmation",
    bodyText: "You were billed today.",
  }),
  extraction: "extraction_failure",
};

/**
 * The model returns a slightly misspelled vendor name ("Vidoe") that fuzzy-matches
 * the canonical "Amazon Prime Video" above the match threshold but isn't exact:
 * must be routed to review rather than silently auto-merged.
 */
/**
 * Trial converted to paid: same vendor, promotional price replaced by the regular plan.
 * Should be treated as a price change on the existing subscription, not a second one.
 */
export const TRIAL_UPGRADE: PipelineFixture = {
  name: "trial_upgrade",
  message: message({
    id: "msg_trial_upgrade",
    subject: "Your Netflix trial has ended",
    sender: "info@netflix.com",
    snippet: "trial ends, your plan is now billed monthly",
    bodyText: "Your free trial has ended. You were billed $15.49 today, renews 2026-11-01.",
  }),
  extraction: extraction({ priceAmount: 15.49, renewalDate: new Date("2026-11-01") }),
};

export const TRIAL_START: PipelineFixture = {
  name: "trial_start",
  message: message({
    id: "msg_trial_start",
    subject: "Welcome to your Netflix trial",
    sender: "info@netflix.com",
    snippet: "trial started, billed monthly after trial ends",
    bodyText: "Your trial is active. Introductory price $7.99, renews 2026-10-01.",
  }),
  extraction: extraction({ priceAmount: 7.99, renewalDate: new Date("2026-10-01") }),
};

/** Looks like a receipt to the prefilter, but the model is sure it is not a subscription. */
export const RECEIPT_LOOKALIKE: PipelineFixture = {
  name: "receipt_lookalike",
  message: message({
    id: "msg_one_off",
    subject: "Your receipt for a one-time purchase",
    sender: "store@retailer.example",
    snippet: "receipt, payment confirmation",
    bodyText: "Thanks for buying a gift card. This is not a recurring charge.",
  }),
  extraction: extraction({ isSubscription: false, vendor: "Retailer", confidence: 0.96 }),
};

export const FUZZY_VENDOR_MATCH: PipelineFixture = {
  name: "fuzzy_vendor_match",
  message: message({
    id: "msg_fuzzy_vendor",
    subject: "Your Amazon Prime Video receipt",
    sender: "auto-confirm@amazon.com",
    snippet: "payment confirmation",
    bodyText: "You were billed $8.99 today, renews 2026-11-01.",
  }),
  extraction: extraction({ vendor: "Amazon Prime Vidoe", priceAmount: 8.99, renewalDate: new Date("2026-11-01") }),
};
