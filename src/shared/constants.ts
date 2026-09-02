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
  "trial ends",
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

export const EXTRACTION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["is_subscription", "vendor", "price", "billing_cycle", "renewal_date", "confidence"],
  properties: {
    is_subscription: { type: "boolean" },
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
