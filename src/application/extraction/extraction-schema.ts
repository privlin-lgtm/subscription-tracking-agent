import { z } from "zod";
import { tryNormalizeCurrency } from "@/domain/value-objects/currency";
import type { ExtractionResult } from "@/domain/ports";

const billingCycleSchema = z.enum(["weekly", "monthly", "annual", "custom", "unknown"]);

export const llmExtractionSchema = z.object({
  is_subscription: z.boolean(),
  is_cancellation: z.boolean(),
  vendor: z.string().min(1).max(200),
  price: z.object({
    amount: z.number(),
    currency: z.string().min(3).max(8),
  }),
  billing_cycle: billingCycleSchema,
  renewal_date: z.string().nullable(),
  confidence: z.number(),
});

export type LlmExtraction = z.infer<typeof llmExtractionSchema>;

const MAX_RENEWAL_YEARS = 5;
const RECENT_PAST_DAYS = 45;

export function parseLlmExtraction(raw: unknown, now = new Date()): ExtractionResult {
  const parsed = llmExtractionSchema.parse(raw);
  const confidence = Number.isFinite(parsed.confidence)
    ? Math.min(1, Math.max(0, parsed.confidence))
    : 0;

  const currency = tryNormalizeCurrency(parsed.price.currency) ?? parsed.price.currency.toUpperCase();
  const renewalDate = parseRenewalDate(parsed.renewal_date, now);

  return {
    isSubscription: parsed.is_subscription,
    isCancellation: parsed.is_cancellation,
    vendor: parsed.vendor.trim(),
    priceAmount: parsed.price.amount,
    currency,
    billingCycle: parsed.billing_cycle,
    renewalDate,
    confidence,
  };
}

function parseRenewalDate(value: string | null, now: Date): Date | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const max = new Date(now);
  max.setFullYear(max.getFullYear() + MAX_RENEWAL_YEARS);
  const min = new Date(now);
  min.setDate(min.getDate() - RECENT_PAST_DAYS);
  if (date > max || date < min) {
    return null;
  }
  return date;
}
