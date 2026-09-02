export const SUBSCRIPTION_KEYWORDS = [
  "subscription",
  "renewal",
  "receipt",
  "invoice",
  "billed",
  "billing",
  "payment confirmation",
  "your plan",
  "membership",
  "trial",
  "auto-renew",
  "autorenew",
  "recurring",
];

export const KNOWN_BILLING_DOMAINS = [
  "netflix.com",
  "spotify.com",
  "apple.com",
  "google.com",
  "microsoft.com",
  "adobe.com",
  "amazon.com",
  "github.com",
  "openai.com",
  "stripe.com",
  "paypal.com",
];

/** Whether a sender address's domain is on the known-billing-domain allowlist. */
export function isKnownBillingSender(sender: string): boolean {
  const lower = sender.toLowerCase();
  return KNOWN_BILLING_DOMAINS.some((domain) => lower.includes(domain));
}

export const EXTRACTION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["is_subscription", "is_cancellation", "vendor", "price", "billing_cycle", "renewal_date", "confidence"],
  properties: {
    is_subscription: { type: "boolean" },
    is_cancellation: { type: "boolean" },
    vendor: { type: "string" },
    price: {
      type: "object",
      additionalProperties: false,
      required: ["amount", "currency"],
      properties: {
        amount: { type: "number" },
        currency: { type: "string" },
      },
    },
    billing_cycle: {
      type: "string",
      enum: ["weekly", "monthly", "annual", "custom", "unknown"],
    },
    renewal_date: { type: ["string", "null"] },
    confidence: { type: "number" },
  },
} as const;
