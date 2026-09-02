import type { BillingCycle } from "@prisma/client";
import type { ExtractionResult, GmailMessage } from "@/domain/ports";

/**
 * Phase 7 "Adversarial Testing" (tool: Claude), per subscription-tracking-agent-prompts.md.
 *
 * 100 difficult email examples across the six categories the prompt names — ambiguous
 * invoices, trial subscriptions, international currencies, mixed languages, changed pricing
 * models, and partial renewal notices — each paired with an "expected output": the
 * `extraction` a well-behaved LLM should produce, and the `expectedOutcome` the deterministic
 * pipeline should reach given that extraction. There is no live LLM in this environment, so
 * `extraction` is ground truth we supply (a fake ExtractionAgent returns it), not something
 * graded here — see adversarial.pipeline.test.ts, which runs all 100 through the real
 * SubscriptionPipelineService, and docs/phase7-data-quality-validation.md, which reports the
 * results and analyzes every case that didn't reach its expected outcome.
 */

export type ExpectedOutcome = "created" | "renewed" | "price_changed" | "duplicate" | "pending_review" | "not_subscription";

export type PriorSubscriptionSeed = {
  vendorNormalized: string;
  priceAmountCents: number;
  priceCurrency: string;
  billingCycle: BillingCycle;
  nextRenewalDate: Date | null;
};

export type AdversarialFixture = {
  id: string;
  category:
    | "ambiguous_invoice"
    | "trial_subscription"
    | "international_currency"
    | "mixed_language"
    | "changed_pricing_model"
    | "partial_renewal_notice";
  message: GmailMessage;
  extraction: ExtractionResult | "extraction_failure";
  priorSubscription?: PriorSubscriptionSeed;
  expectedOutcome: ExpectedOutcome;
  notes: string;
};

let seq = 0;
function msg(input: { subject: string; sender: string; bodyText: string; snippet?: string }): GmailMessage {
  seq += 1;
  return {
    id: `adv_msg_${seq}`,
    historyId: "1",
    threadId: `thread_adv_${seq}`,
    subject: input.subject,
    sender: input.sender,
    snippet: input.snippet ?? input.bodyText.slice(0, 100),
    bodyText: input.bodyText,
    internalDate: new Date("2026-09-10"),
  };
}

function ext(overrides: Partial<ExtractionResult> = {}): ExtractionResult {
  return {
    isSubscription: true,
    isCancellation: false,
    vendor: "Vendor",
    priceAmount: 9.99,
    currency: "USD",
    billingCycle: "monthly",
    renewalDate: new Date("2026-10-10"),
    confidence: 0.92,
    ...overrides,
  };
}

const cents = (amount: number): number => Math.round(amount * 100);

// ---------------------------------------------------------------------------------------
// Category 1: Ambiguous invoices — genuine subscriptions worded like generic invoices,
// and one-time purchases worded like they might recur. 17 examples.
// ---------------------------------------------------------------------------------------

export const AMBIGUOUS_INVOICES: AdversarialFixture[] = [
  {
    id: "ambiguous-01",
    category: "ambiguous_invoice",
    message: msg({
      subject: "Invoice #AD-88213",
      sender: "billing@adobe.com",
      bodyText: "Adobe Creative Cloud. Amount due: $52.99. Billing period: monthly. Next charge: 2026-10-15.",
    }),
    extraction: ext({ vendor: "Adobe", priceAmount: 52.99, renewalDate: new Date("2026-10-15"), confidence: 0.88 }),
    expectedOutcome: "created",
    notes: "Genuine subscription with a generic 'Invoice #' subject and no subscription keywords beyond 'billing period'.",
  },
  {
    id: "ambiguous-02",
    category: "ambiguous_invoice",
    message: msg({
      subject: "Invoice #4471 from Acme Consulting LLC",
      sender: "accounts@acmeconsulting.example",
      bodyText: "Thank you for your business. Invoice total: $1,200.00 for project services rendered in September.",
    }),
    extraction: ext({ isSubscription: false, vendor: "Acme Consulting", priceAmount: 1200, confidence: 0.94 }),
    expectedOutcome: "not_subscription",
    notes: "One-time B2B project invoice; no recurring cadence despite the 'invoice' keyword passing the prefilter.",
  },
  {
    id: "ambiguous-03",
    category: "ambiguous_invoice",
    message: msg({
      subject: "Your Zoom invoice is ready",
      sender: "billing@zoom.us",
      bodyText: "Zoom Pro plan. $14.99 charged monthly. Your next invoice is 2026-10-12.",
    }),
    extraction: ext({ vendor: "Zoom", priceAmount: 14.99, renewalDate: new Date("2026-10-12"), confidence: 0.9 }),
    expectedOutcome: "created",
    notes: "Genuine SaaS subscription, invoice-style phrasing.",
  },
  {
    id: "ambiguous-04",
    category: "ambiguous_invoice",
    message: msg({
      subject: "Your Best Buy receipt",
      sender: "orders@bestbuy.example",
      bodyText: "Thanks for your purchase. 55in TV: $349.00. Receipt #BB-99213.",
    }),
    extraction: ext({ isSubscription: false, vendor: "Best Buy", priceAmount: 349, confidence: 0.97 }),
    expectedOutcome: "not_subscription",
    notes: "Retail receipt for a one-time hardware purchase.",
  },
  {
    id: "ambiguous-05",
    category: "ambiguous_invoice",
    message: msg({
      subject: "Squarespace invoice",
      sender: "billing@squarespace.com",
      bodyText: "Website plan renewal. $192.00 billed annually. Renews 2027-09-10.",
    }),
    extraction: ext({ vendor: "Squarespace", priceAmount: 192, billingCycle: "annual", renewalDate: new Date("2027-09-10"), confidence: 0.87 }),
    expectedOutcome: "created",
    notes: "Genuine annual subscription, invoice framing.",
  },
  {
    id: "ambiguous-06",
    category: "ambiguous_invoice",
    message: msg({
      subject: "Invoice for your Home Depot order",
      sender: "receipts@homedepot.example",
      bodyText: "Order total: $89.47 for lumber and paint. Thank you for shopping with us.",
    }),
    extraction: ext({ isSubscription: false, vendor: "Home Depot", priceAmount: 89.47, confidence: 0.95 }),
    expectedOutcome: "not_subscription",
    notes: "One-time hardware-store purchase invoice.",
  },
  {
    id: "ambiguous-07",
    category: "ambiguous_invoice",
    message: msg({
      subject: "Notion Team plan invoice",
      sender: "billing@makenotion.com",
      bodyText: "Notion Team plan. $8.00 per member, billed monthly. Next charge 2026-10-08.",
    }),
    extraction: ext({ vendor: "Notion", priceAmount: 8, renewalDate: new Date("2026-10-08"), confidence: 0.86 }),
    expectedOutcome: "created",
    notes: "Genuine subscription, per-seat pricing phrasing could confuse a naive parser.",
  },
  {
    id: "ambiguous-08",
    category: "ambiguous_invoice",
    message: msg({
      subject: "Payment invoice from Fiverr",
      sender: "payments@fiverr.example",
      bodyText: "You paid $65.00 for a completed freelance gig: logo design.",
    }),
    extraction: ext({ isSubscription: false, vendor: "Fiverr", priceAmount: 65, confidence: 0.93 }),
    expectedOutcome: "not_subscription",
    notes: "One-time marketplace gig payment, not a subscription.",
  },
  {
    id: "ambiguous-09",
    category: "ambiguous_invoice",
    message: msg({
      subject: "Invoice #DO-5521",
      sender: "billing@digitalocean.com",
      bodyText: "DigitalOcean droplet usage. $24.00 for this billing cycle. Next invoice 2026-10-01.",
    }),
    extraction: ext({ vendor: "DigitalOcean", priceAmount: 24, renewalDate: new Date("2026-10-01"), confidence: 0.85 }),
    expectedOutcome: "created",
    notes: "Genuine recurring cloud-hosting charge with a bare invoice-number subject.",
  },
  {
    id: "ambiguous-10",
    category: "ambiguous_invoice",
    message: msg({
      subject: "Your Ticketmaster receipt",
      sender: "tickets@ticketmaster.example",
      bodyText: "2 tickets to Saturday's show: $145.00. Enjoy the event!",
    }),
    extraction: ext({ isSubscription: false, vendor: "Ticketmaster", priceAmount: 145, confidence: 0.96 }),
    expectedOutcome: "not_subscription",
    notes: "Event ticket receipt, single purchase.",
  },
  {
    id: "ambiguous-11",
    category: "ambiguous_invoice",
    message: msg({
      subject: "Grammarly invoice",
      sender: "billing@grammarly.com",
      bodyText: "Grammarly Premium. $12.00 billed monthly. Next billing date 2026-10-05.",
    }),
    extraction: ext({ vendor: "Grammarly", priceAmount: 12, renewalDate: new Date("2026-10-05"), confidence: 0.89 }),
    expectedOutcome: "created",
    notes: "Genuine subscription.",
  },
  {
    id: "ambiguous-12",
    category: "ambiguous_invoice",
    message: msg({
      subject: "Your Ikea order invoice",
      sender: "orders@ikea.example",
      bodyText: "Order confirmed: bookshelf and lamp, $212.30 total.",
    }),
    extraction: ext({ isSubscription: false, vendor: "Ikea", priceAmount: 212.3, confidence: 0.95 }),
    expectedOutcome: "not_subscription",
    notes: "Furniture purchase, one-time.",
  },
  {
    id: "ambiguous-13",
    category: "ambiguous_invoice",
    message: msg({
      subject: "Canva Pro invoice",
      sender: "billing@canva.com",
      bodyText: "Canva Pro. $12.99 monthly. Next charge 2026-10-14.",
    }),
    extraction: ext({ vendor: "Canva", priceAmount: 12.99, renewalDate: new Date("2026-10-14"), confidence: 0.88 }),
    expectedOutcome: "created",
    notes: "Genuine subscription.",
  },
  {
    id: "ambiguous-14",
    category: "ambiguous_invoice",
    message: msg({
      subject: "Your Uber receipt",
      sender: "receipts@uber.example",
      bodyText: "Trip total: $23.40. Thanks for riding with Uber.",
    }),
    extraction: ext({ isSubscription: false, vendor: "Uber", priceAmount: 23.4, confidence: 0.97 }),
    expectedOutcome: "not_subscription",
    notes: "One-off ride receipt.",
  },
  {
    id: "ambiguous-15",
    category: "ambiguous_invoice",
    message: msg({
      subject: "1Password invoice",
      sender: "billing@1password.com",
      bodyText: "1Password Individual. $2.99 monthly. Next charge 2026-10-03.",
    }),
    extraction: ext({ vendor: "1Password", priceAmount: 2.99, renewalDate: new Date("2026-10-03"), confidence: 0.87 }),
    expectedOutcome: "created",
    notes: "Genuine subscription, small amount could look like a fee rather than a plan.",
  },
  {
    id: "ambiguous-16",
    category: "ambiguous_invoice",
    message: msg({
      subject: "Your Delta Air Lines receipt",
      sender: "receipts@delta.example",
      bodyText: "Flight JFK-LAX confirmed. Total charged: $412.00.",
    }),
    extraction: ext({ isSubscription: false, vendor: "Delta Air Lines", priceAmount: 412, confidence: 0.96 }),
    expectedOutcome: "not_subscription",
    notes: "Airline ticket receipt, single purchase.",
  },
  {
    id: "ambiguous-17",
    category: "ambiguous_invoice",
    message: msg({
      subject: "Dropbox invoice",
      sender: "billing@dropbox.com",
      bodyText: "Dropbox Plus. $11.99 monthly. Next billing date 2026-10-09.",
    }),
    extraction: ext({ vendor: "Dropbox", priceAmount: 11.99, renewalDate: new Date("2026-10-09"), confidence: 0.88 }),
    expectedOutcome: "created",
    notes: "Genuine subscription.",
  },
];

// ---------------------------------------------------------------------------------------
// Category 2: Trial subscriptions — trial start, trial-ending reminders (usually missing
// price/date), and trial-to-paid conversions. 17 examples.
// ---------------------------------------------------------------------------------------

export const TRIAL_SUBSCRIPTIONS: AdversarialFixture[] = [
  {
    id: "trial-01",
    category: "trial_subscription",
    message: msg({
      subject: "Your Netflix trial is ending soon",
      sender: "info@netflix.com",
      bodyText: "Your free trial ends soon. Choose a plan to keep watching.",
    }),
    extraction: ext({ vendor: "Netflix", priceAmount: 0, currency: "USD", renewalDate: null, billingCycle: "unknown", confidence: 0.5 }),
    expectedOutcome: "pending_review",
    notes: "No price committed yet; missing price forces review regardless of domain trust.",
  },
  {
    id: "trial-02",
    category: "trial_subscription",
    message: msg({
      subject: "Your Spotify Premium subscription has started",
      sender: "no-reply@spotify.com",
      bodyText: "Your trial has ended. You were billed $10.99 today, renews 2026-10-11.",
    }),
    extraction: ext({ vendor: "Spotify", priceAmount: 10.99, renewalDate: new Date("2026-10-11"), confidence: 0.9 }),
    expectedOutcome: "created",
    notes: "First real charge after trial conversion, fully specified.",
  },
  {
    id: "trial-03",
    category: "trial_subscription",
    message: msg({
      subject: "Your Audible trial ends in 3 days",
      sender: "no-reply@audible.example",
      bodyText: "Your trial ends in 3 days. After that, membership continues automatically.",
    }),
    extraction: ext({ vendor: "Audible", priceAmount: 0, currency: "USD", renewalDate: null, billingCycle: "unknown", confidence: 0.55 }),
    expectedOutcome: "pending_review",
    notes: "Vague reminder, no committed price yet.",
  },
  {
    id: "trial-04",
    category: "trial_subscription",
    message: msg({
      subject: "Welcome to your YouTube Premium free trial",
      sender: "no-reply@youtube.example",
      bodyText: "Your free trial has started. Enjoy ad-free videos.",
    }),
    extraction: ext({ vendor: "YouTube Premium", priceAmount: 0, currency: "USD", renewalDate: null, billingCycle: "unknown", confidence: 0.6 }),
    expectedOutcome: "pending_review",
    notes: "Trial start, $0, no billing detail yet.",
  },
  {
    id: "trial-05",
    category: "trial_subscription",
    message: msg({
      subject: "Your Headspace annual trial ends soon",
      sender: "billing@headspace.example",
      bodyText: "Your trial ends soon. You will be charged $69.99 on 2026-10-20 unless you cancel.",
    }),
    extraction: ext({
      vendor: "Headspace",
      priceAmount: 69.99,
      billingCycle: "annual",
      renewalDate: new Date("2026-10-20"),
      confidence: 0.82,
    }),
    expectedOutcome: "pending_review",
    notes: "A future pending charge notice, not a receipt — model self-reports moderate confidence, which lands just under the 0.85 auto-apply threshold.",
  },
  {
    id: "trial-06",
    category: "trial_subscription",
    message: msg({
      subject: "Your Duolingo Plus subscription has started",
      sender: "no-reply@duolingo.example",
      bodyText: "Trial complete. You were billed $6.99 today, renews 2026-10-13.",
    }),
    extraction: ext({ vendor: "Duolingo Plus", priceAmount: 6.99, renewalDate: new Date("2026-10-13"), confidence: 0.89 }),
    expectedOutcome: "created",
    notes: "Clean trial-to-paid conversion.",
  },
  {
    id: "trial-07",
    category: "trial_subscription",
    message: msg({
      subject: "Your Peloton App trial",
      sender: "no-reply@onepeloton.example",
      bodyText: "Your trial is active. We'll remind you before it ends.",
    }),
    extraction: ext({ vendor: "Peloton App", priceAmount: 0, currency: "USD", renewalDate: null, billingCycle: "unknown", confidence: 0.5 }),
    expectedOutcome: "pending_review",
    notes: "Pure trial-active notice, no billing detail.",
  },
  {
    id: "trial-08",
    category: "trial_subscription",
    message: msg({
      subject: "Your Adobe Photoshop subscription starts in 7 days",
      sender: "billing@adobe.com",
      bodyText: "Your subscription starts in 7 days. We'll send a receipt once billed.",
    }),
    extraction: ext({ vendor: "Adobe", priceAmount: 0, currency: "USD", renewalDate: new Date("2026-09-17"), billingCycle: "unknown", confidence: 0.6 }),
    expectedOutcome: "pending_review",
    notes: "Upcoming, not-yet-billed trial conversion; price missing forces review.",
  },
  {
    id: "trial-09",
    category: "trial_subscription",
    message: msg({
      subject: "Your Hulu subscription has started",
      sender: "no-reply@hulu.example",
      bodyText: "Trial ended. You were billed $7.99 today, renews 2026-10-15.",
    }),
    extraction: ext({ vendor: "Hulu", priceAmount: 7.99, renewalDate: new Date("2026-10-15"), confidence: 0.9 }),
    expectedOutcome: "created",
    notes: "Clean conversion.",
  },
  {
    id: "trial-10",
    category: "trial_subscription",
    message: msg({
      subject: "Your Codecademy Pro trial is ending",
      sender: "no-reply@codecademy.example",
      bodyText: "Your trial ends soon. Upgrade to keep learning without interruption.",
    }),
    extraction: ext({ vendor: "Codecademy Pro", priceAmount: 0, currency: "USD", renewalDate: null, billingCycle: "unknown", confidence: 0.45 }),
    expectedOutcome: "pending_review",
    notes: "Vague marketing-style trial reminder.",
  },
  {
    id: "trial-11",
    category: "trial_subscription",
    message: msg({
      subject: "Your NordVPN subscription has started",
      sender: "billing@nordvpn.example",
      bodyText: "Trial converted. You were billed $59.88 today for the annual plan, renews 2027-09-10.",
    }),
    extraction: ext({ vendor: "NordVPN", priceAmount: 59.88, billingCycle: "annual", renewalDate: new Date("2027-09-10"), confidence: 0.9 }),
    expectedOutcome: "created",
    notes: "Clean annual conversion.",
  },
  {
    id: "trial-12",
    category: "trial_subscription",
    message: msg({
      subject: "Your Kindle Unlimited trial",
      sender: "no-reply@amazon.com",
      bodyText: "Enjoy your Kindle Unlimited trial. Read as much as you want.",
    }),
    extraction: ext({ vendor: "Kindle Unlimited", priceAmount: 0, currency: "USD", renewalDate: null, billingCycle: "unknown", confidence: 0.55 }),
    expectedOutcome: "pending_review",
    notes: "Trial-start notice, no billing detail.",
  },
  {
    id: "trial-13",
    category: "trial_subscription",
    message: msg({
      subject: "Your Calm trial ends soon",
      sender: "no-reply@calm.example",
      bodyText: "Your trial ends soon. Don't lose access to your favorite sessions.",
    }),
    extraction: ext({ vendor: "Calm", priceAmount: 0, currency: "USD", renewalDate: null, billingCycle: "unknown", confidence: 0.5 }),
    expectedOutcome: "pending_review",
    notes: "Vague trial-ending reminder.",
  },
  {
    id: "trial-14",
    category: "trial_subscription",
    message: msg({
      subject: "Your ExpressVPN subscription has started",
      sender: "billing@expressvpn.example",
      bodyText: "Trial converted. You were billed $8.32 today, renews 2026-10-10.",
    }),
    extraction: ext({ vendor: "ExpressVPN", priceAmount: 8.32, renewalDate: new Date("2026-10-10"), confidence: 0.88 }),
    expectedOutcome: "created",
    notes: "Clean conversion.",
  },
  {
    id: "trial-15",
    category: "trial_subscription",
    message: msg({
      subject: "Your Skillshare subscription has started",
      sender: "billing@skillshare.example",
      bodyText: "Trial converted to the quarterly plan. You were billed $32.00 today, renews 2026-12-10.",
    }),
    extraction: ext({ vendor: "Skillshare", priceAmount: 32, billingCycle: "custom", renewalDate: new Date("2026-12-10"), confidence: 0.85 }),
    expectedOutcome: "created",
    notes: "Quarterly cycle maps to CUSTOM in the billing-cycle enum; still a clean conversion.",
  },
  {
    id: "trial-16",
    category: "trial_subscription",
    message: msg({
      subject: "Your Masterclass trial",
      sender: "no-reply@masterclass.example",
      bodyText: "Your trial is active. We'll let you know before it ends.",
    }),
    extraction: ext({ vendor: "Masterclass", priceAmount: 0, currency: "USD", renewalDate: null, billingCycle: "unknown", confidence: 0.5 }),
    expectedOutcome: "pending_review",
    notes: "Trial-active notice, no billing detail.",
  },
  {
    id: "trial-17",
    category: "trial_subscription",
    message: msg({
      subject: "Your Babbel subscription has started",
      sender: "billing@babbel.example",
      bodyText: "Trial converted to the annual plan. You were billed $83.40 today, renews 2027-09-10.",
    }),
    extraction: ext({ vendor: "Babbel", priceAmount: 83.4, billingCycle: "annual", renewalDate: new Date("2027-09-10"), confidence: 0.89 }),
    expectedOutcome: "created",
    notes: "Clean annual conversion.",
  },
];

// ---------------------------------------------------------------------------------------
// Category 3: International currencies — 15 valid ISO 4217 currencies (should all create
// cleanly), plus 2 malformed-currency extractions (symbol instead of code) that must be
// caught by the ISO 4217 guard rather than silently accepted. 17 examples.
// ---------------------------------------------------------------------------------------

export const INTERNATIONAL_CURRENCIES: AdversarialFixture[] = [
  {
    id: "intl-01",
    category: "international_currency",
    message: msg({ subject: "Your Netflix receipt", sender: "info@netflix.com", bodyText: "You were billed EUR 13.99 today, renews 2026-10-10." }),
    extraction: ext({ vendor: "Netflix", priceAmount: 13.99, currency: "EUR", confidence: 0.91 }),
    expectedOutcome: "created",
    notes: "Valid EUR receipt.",
  },
  {
    id: "intl-02",
    category: "international_currency",
    message: msg({ subject: "Your Spotify receipt", sender: "no-reply@spotify.com", bodyText: "You were billed GBP 10.99 today, renews 2026-10-10." }),
    extraction: ext({ vendor: "Spotify", priceAmount: 10.99, currency: "GBP", confidence: 0.9 }),
    expectedOutcome: "created",
    notes: "Valid GBP receipt.",
  },
  {
    id: "intl-03",
    category: "international_currency",
    message: msg({ subject: "Your Amazon Prime receipt", sender: "auto-confirm@amazon.com", bodyText: "You were billed JPY 500 today, renews 2026-10-10." }),
    extraction: ext({ vendor: "Amazon Prime", priceAmount: 500, currency: "JPY", confidence: 0.88 }),
    expectedOutcome: "created",
    notes: "Valid zero-decimal JPY receipt (minor unit factor 1).",
  },
  {
    id: "intl-04",
    category: "international_currency",
    message: msg({ subject: "Your Hotstar receipt", sender: "billing@hotstar.example", bodyText: "You were billed INR 299 today, renews 2026-10-10." }),
    extraction: ext({ vendor: "Hotstar", priceAmount: 299, currency: "INR", confidence: 0.87 }),
    expectedOutcome: "created",
    notes: "Valid INR receipt.",
  },
  {
    id: "intl-05",
    category: "international_currency",
    message: msg({ subject: "Your Globo Play receipt", sender: "billing@globoplay.example", bodyText: "You were billed BRL 24.90 today, renews 2026-10-10." }),
    extraction: ext({ vendor: "Globo Play", priceAmount: 24.9, currency: "BRL", confidence: 0.87 }),
    expectedOutcome: "created",
    notes: "Valid BRL receipt.",
  },
  {
    id: "intl-06",
    category: "international_currency",
    message: msg({ subject: "Your Canva receipt", sender: "billing@canva.com", bodyText: "You were billed AUD 15.00 today, renews 2026-10-10." }),
    extraction: ext({ vendor: "Canva", priceAmount: 15, currency: "AUD", confidence: 0.89 }),
    expectedOutcome: "created",
    notes: "Valid AUD receipt.",
  },
  {
    id: "intl-07",
    category: "international_currency",
    message: msg({ subject: "Your Shopify receipt", sender: "billing@shopify.example", bodyText: "You were billed CAD 39.00 today, renews 2026-10-10." }),
    extraction: ext({ vendor: "Shopify", priceAmount: 39, currency: "CAD", confidence: 0.86 }),
    expectedOutcome: "created",
    notes: "Valid CAD receipt.",
  },
  {
    id: "intl-08",
    category: "international_currency",
    message: msg({ subject: "Your Netflix receipt", sender: "info@netflix.com", bodyText: "You were billed MXN 219 today, renews 2026-10-10." }),
    extraction: ext({ vendor: "Netflix", priceAmount: 219, currency: "MXN", confidence: 0.88 }),
    expectedOutcome: "created",
    notes: "Valid MXN receipt.",
  },
  {
    id: "intl-09",
    category: "international_currency",
    message: msg({ subject: "Your Spotify receipt", sender: "no-reply@spotify.com", bodyText: "You were billed CHF 12.95 today, renews 2026-10-10." }),
    extraction: ext({ vendor: "Spotify", priceAmount: 12.95, currency: "CHF", confidence: 0.88 }),
    expectedOutcome: "created",
    notes: "Valid CHF receipt.",
  },
  {
    id: "intl-10",
    category: "international_currency",
    message: msg({ subject: "Your Storytel receipt", sender: "billing@storytel.example", bodyText: "You were billed SEK 149 today, renews 2026-10-10." }),
    extraction: ext({ vendor: "Storytel", priceAmount: 149, currency: "SEK", confidence: 0.85 }),
    expectedOutcome: "created",
    notes: "Valid SEK receipt.",
  },
  {
    id: "intl-11",
    category: "international_currency",
    message: msg({ subject: "Your Netflix receipt", sender: "info@netflix.com", bodyText: "You were billed ZAR 199 today, renews 2026-10-10." }),
    extraction: ext({ vendor: "Netflix", priceAmount: 199, currency: "ZAR", confidence: 0.87 }),
    expectedOutcome: "created",
    notes: "Valid ZAR receipt.",
  },
  {
    id: "intl-12",
    category: "international_currency",
    message: msg({ subject: "Your Coupang Play receipt", sender: "billing@coupangplay.example", bodyText: "You were billed KRW 4900 today, renews 2026-10-10." }),
    extraction: ext({ vendor: "Coupang Play", priceAmount: 4900, currency: "KRW", confidence: 0.86 }),
    expectedOutcome: "created",
    notes: "Valid zero-decimal KRW receipt (minor unit factor 1).",
  },
  {
    id: "intl-13",
    category: "international_currency",
    message: msg({ subject: "Your Grab receipt", sender: "billing@grab.example", bodyText: "You were billed SGD 9.90 today, renews 2026-10-10." }),
    extraction: ext({ vendor: "GrabPay Plus", priceAmount: 9.9, currency: "SGD", confidence: 0.85 }),
    expectedOutcome: "created",
    notes: "Valid SGD receipt.",
  },
  {
    id: "intl-14",
    category: "international_currency",
    message: msg({ subject: "Your Spotify receipt", sender: "no-reply@spotify.com", bodyText: "You were billed NZD 14.99 today, renews 2026-10-10." }),
    extraction: ext({ vendor: "Spotify", priceAmount: 14.99, currency: "NZD", confidence: 0.88 }),
    expectedOutcome: "created",
    notes: "Valid NZD receipt.",
  },
  {
    id: "intl-15",
    category: "international_currency",
    message: msg({ subject: "Your Netflix receipt", sender: "info@netflix.com", bodyText: "You were billed PLN 43.00 today, renews 2026-10-10." }),
    extraction: ext({ vendor: "Netflix", priceAmount: 43, currency: "PLN", confidence: 0.87 }),
    expectedOutcome: "created",
    notes: "Valid PLN receipt.",
  },
  {
    id: "intl-16",
    category: "international_currency",
    message: msg({ subject: "Your Netflix receipt", sender: "info@netflix.com", bodyText: "You were billed ₺45 today, renews 2026-10-10." }),
    extraction: ext({ vendor: "Netflix", priceAmount: 45, currency: "₺", confidence: 0.83 }),
    expectedOutcome: "pending_review",
    notes: "The model returns the Turkish lira SYMBOL (₺) instead of the ISO code TRY — tests that the currency-validity guard catches a malformed but plausible-looking extraction.",
  },
  {
    id: "intl-17",
    category: "international_currency",
    message: msg({ subject: "Your Spotify receipt", sender: "no-reply@spotify.com", bodyText: "You were billed R$ 21.90 today, renews 2026-10-10." }),
    extraction: ext({ vendor: "Spotify", priceAmount: 21.9, currency: "R$", confidence: 0.8 }),
    expectedOutcome: "pending_review",
    notes: "The model returns the Brazilian real SYMBOL ('R$') instead of the ISO code BRL — same guard, different malformed value.",
  },
];

// ---------------------------------------------------------------------------------------
// Category 4: Mixed languages — non-English billing emails. Known-billing-domain senders
// still reach extraction and should create cleanly; unfamiliar local-vendor domains are
// dropped by the (English-keyword) prefilter before the LLM ever sees them, per the
// international-billing gap documented in docs/phase5-extraction-validation.md. 17 examples.
// ---------------------------------------------------------------------------------------

export const MIXED_LANGUAGE: AdversarialFixture[] = [
  {
    id: "lang-01",
    category: "mixed_language",
    message: msg({
      subject: "Tu suscripción a Netflix",
      sender: "info@netflix.com",
      bodyText: "Se te cobraron $13.99 hoy. Se renueva el 2026-10-10.",
      snippet: "recibo de pago",
    }),
    extraction: ext({ vendor: "Netflix", priceAmount: 13.99, confidence: 0.86 }),
    expectedOutcome: "created",
    notes: "Spanish body, but sender is a known billing domain so the prefilter passes on the domain match, not on keywords.",
  },
  {
    id: "lang-02",
    category: "mixed_language",
    message: msg({
      subject: "Votre abonnement Spotify",
      sender: "no-reply@spotify.com",
      bodyText: "Vous avez été facturé 10,99 EUR aujourd'hui. Renouvellement le 2026-10-10.",
      snippet: "confirmation de paiement",
    }),
    extraction: ext({ vendor: "Spotify", priceAmount: 10.99, currency: "EUR", confidence: 0.86 }),
    expectedOutcome: "created",
    notes: "French body, known domain.",
  },
  {
    id: "lang-03",
    category: "mixed_language",
    message: msg({
      subject: "Ihre Rechnung von Apple",
      sender: "no_reply@apple.com",
      bodyText: "iCloud+. Ihnen wurden 2,99 EUR berechnet. Nächste Abbuchung: 2026-10-10.",
      snippet: "Zahlungsbestätigung",
    }),
    extraction: ext({ vendor: "iCloud+", priceAmount: 2.99, currency: "EUR", confidence: 0.85 }),
    expectedOutcome: "created",
    notes: "German body, known domain.",
  },
  {
    id: "lang-04",
    category: "mixed_language",
    message: msg({
      subject: "Seu recibo da Amazon Prime",
      sender: "auto-confirm@amazon.com",
      bodyText: "Você foi cobrado R$ 19,90 hoje. Renova em 2026-10-10.",
      snippet: "recibo",
    }),
    extraction: ext({ vendor: "Amazon Prime", priceAmount: 19.9, currency: "BRL", confidence: 0.84 }),
    expectedOutcome: "created",
    notes: "Portuguese body, known domain.",
  },
  {
    id: "lang-05",
    category: "mixed_language",
    message: msg({
      subject: "Il tuo abbonamento Netflix",
      sender: "info@netflix.com",
      bodyText: "Ti è stato addebitato 12,99 EUR oggi. Rinnovo il 2026-10-10.",
      snippet: "conferma di pagamento",
    }),
    extraction: ext({ vendor: "Netflix", priceAmount: 12.99, currency: "EUR", confidence: 0.85 }),
    expectedOutcome: "created",
    notes: "Italian body, known domain.",
  },
  {
    id: "lang-06",
    category: "mixed_language",
    message: msg({
      subject: "Uw Google One-abonnement",
      sender: "no-reply@google.com",
      bodyText: "U bent €1,99 in rekening gebracht. Verlengt op 2026-10-10.",
      snippet: "betalingsbevestiging",
    }),
    extraction: ext({ vendor: "Google One", priceAmount: 1.99, currency: "EUR", confidence: 0.83 }),
    expectedOutcome: "created",
    notes: "Dutch body, known domain.",
  },
  {
    id: "lang-07",
    category: "mixed_language",
    message: msg({
      subject: "Microsoft 365 のご請求",
      sender: "billing@microsoft.com",
      bodyText: "本日、¥1,490をご請求しました。次回更新日: 2026-10-10。",
      snippet: "支払い確認",
    }),
    extraction: ext({ vendor: "Microsoft 365", priceAmount: 1490, currency: "JPY", confidence: 0.82 }),
    expectedOutcome: "created",
    notes: "Japanese body, known domain.",
  },
  {
    id: "lang-08",
    category: "mixed_language",
    message: msg({
      subject: "Adobe 구독 영수증",
      sender: "billing@adobe.com",
      bodyText: "오늘 ₩15,900이 청구되었습니다. 다음 갱신일: 2026-10-10.",
      snippet: "결제 확인",
    }),
    extraction: ext({ vendor: "Adobe", priceAmount: 15900, currency: "KRW", confidence: 0.81 }),
    expectedOutcome: "created",
    notes: "Korean body, known domain.",
  },
  {
    id: "lang-09",
    category: "mixed_language",
    message: msg({
      subject: "Ваша подписка GitHub",
      sender: "billing@github.com",
      bodyText: "С вас списали $4.00 сегодня. Продление: 2026-10-10.",
      snippet: "подтверждение оплаты",
    }),
    extraction: ext({ vendor: "GitHub", priceAmount: 4, confidence: 0.85 }),
    expectedOutcome: "created",
    notes: "Russian body, known domain.",
  },
  {
    id: "lang-10",
    category: "mixed_language",
    message: msg({
      subject: "Twoja subskrypcja ChatGPT Plus",
      sender: "billing@openai.com",
      bodyText: "Obciążono Cię kwotą $20.00 dzisiaj. Odnowienie: 2026-10-10.",
      snippet: "potwierdzenie płatności",
    }),
    extraction: ext({ vendor: "OpenAI", priceAmount: 20, confidence: 0.86 }),
    expectedOutcome: "created",
    notes: "Polish body, known domain.",
  },
  {
    id: "lang-11",
    category: "mixed_language",
    message: msg({
      subject: "Din Klarna-faktura",
      sender: "receipts@stripe.com",
      bodyText: "Du debiterades 99 SEK idag för ditt Klarna-abonnemang. Förnyas 2026-10-10.",
      snippet: "betalningsbekräftelse",
    }),
    extraction: ext({ vendor: "Klarna", priceAmount: 99, currency: "SEK", confidence: 0.8 }),
    expectedOutcome: "created",
    notes: "Swedish body, billed via stripe.com (a known billing domain) on behalf of the vendor named in the body.",
  },
  {
    id: "lang-12",
    category: "mixed_language",
    message: msg({
      subject: "BluTV aboneliğiniz",
      sender: "receipts@paypal.com",
      bodyText: "Bugün 54,99 TRY tahsil edildi. Yenileme: 2026-10-10.",
      snippet: "ödeme onayı",
    }),
    extraction: ext({ vendor: "BluTV", priceAmount: 54.99, currency: "TRY", confidence: 0.79 }),
    expectedOutcome: "created",
    notes: "Turkish body, billed via paypal.com (known billing domain).",
  },
  {
    id: "lang-13",
    category: "mixed_language",
    message: msg({
      subject: "Votre abonnement Canal+",
      sender: "abonnes@canalplus.fr",
      bodyText: "Vous avez été facturé 19,99 EUR aujourd'hui pour votre abonnement Canal+.",
      snippet: "facture",
    }),
    extraction: ext({ isSubscription: false, vendor: "Canal+", priceAmount: 0, currency: "USD", renewalDate: null, billingCycle: "unknown", confidence: 0 }),
    expectedOutcome: "not_subscription",
    notes: "French sender NOT on the known-billing-domain list, and the body has no English prefilter keyword — dropped before ever reaching the extractor. The extraction here is unreachable filler; the real signal is that processMessage never calls the extractor for this fixture.",
  },
  {
    id: "lang-14",
    category: "mixed_language",
    message: msg({
      subject: "Ihre Sky Deutschland Rechnung",
      sender: "rechnung@sky.de",
      bodyText: "Ihnen wurden 29,99 EUR für Ihr Sky-Abonnement berechnet.",
      snippet: "Rechnung",
    }),
    extraction: ext({ isSubscription: false, vendor: "Sky Deutschland", priceAmount: 0, currency: "USD", renewalDate: null, billingCycle: "unknown", confidence: 0 }),
    expectedOutcome: "not_subscription",
    notes: "German sender not on the known-domain list, no English keyword match — dropped at the prefilter.",
  },
  {
    id: "lang-15",
    category: "mixed_language",
    message: msg({
      subject: "NHKブックスのご利用料金",
      sender: "support@nhk-book.jp",
      bodyText: "今日、¥980をご利用料金としてご請求しました。",
      snippet: "ご利用料金",
    }),
    extraction: ext({ isSubscription: false, vendor: "NHK", priceAmount: 0, currency: "USD", renewalDate: null, billingCycle: "unknown", confidence: 0 }),
    expectedOutcome: "not_subscription",
    notes: "Japanese sender not on the known-domain list, no English keyword match — dropped at the prefilter.",
  },
  {
    id: "lang-16",
    category: "mixed_language",
    message: msg({
      subject: "Sua fatura Vivo",
      sender: "faturas@vivo.com.br",
      bodyText: "Você foi cobrado R$ 89,90 hoje pelo seu plano.",
      snippet: "fatura",
    }),
    extraction: ext({ isSubscription: false, vendor: "Vivo", priceAmount: 0, currency: "USD", renewalDate: null, billingCycle: "unknown", confidence: 0 }),
    expectedOutcome: "not_subscription",
    notes: "Brazilian telecom sender not on the known-domain list, no English keyword match — dropped at the prefilter.",
  },
  {
    id: "lang-17",
    category: "mixed_language",
    message: msg({
      subject: "네이버 플러스 이용료 청구",
      sender: "billing@naver.com",
      bodyText: "오늘 ₩4,900이 청구되었습니다.",
      snippet: "이용료 청구",
    }),
    extraction: ext({ isSubscription: false, vendor: "Naver Plus", priceAmount: 0, currency: "USD", renewalDate: null, billingCycle: "unknown", confidence: 0 }),
    expectedOutcome: "not_subscription",
    notes: "Korean sender not on the known-domain list, no English keyword match — dropped at the prefilter.",
  },
];

// ---------------------------------------------------------------------------------------
// Category 5: Changed pricing models — a prior subscription exists; the new email shifts
// billing cycle, tier, or amount. 16 examples.
// ---------------------------------------------------------------------------------------

function priorUsd(vendor: string, amount: number, cycle: BillingCycle, renewalDate: Date | null = new Date("2026-09-10")): PriorSubscriptionSeed {
  return { vendorNormalized: vendor, priceAmountCents: cents(amount), priceCurrency: "USD", billingCycle: cycle, nextRenewalDate: renewalDate };
}

export const CHANGED_PRICING_MODELS: AdversarialFixture[] = [
  {
    id: "pricing-01",
    category: "changed_pricing_model",
    message: msg({ subject: "Your Netflix receipt", sender: "info@netflix.com", bodyText: "You switched to the annual plan. Billed $149.99 today, renews 2027-10-10." }),
    priorSubscription: priorUsd("Netflix", 15.49, "MONTHLY"),
    extraction: ext({ vendor: "Netflix", priceAmount: 149.99, billingCycle: "annual", renewalDate: new Date("2027-10-10"), confidence: 0.88 }),
    expectedOutcome: "price_changed",
    notes: "Monthly-to-annual switch; also checks whether the pipeline updates billingCycle alongside price (see docs/phase7-data-quality-validation.md).",
  },
  {
    id: "pricing-02",
    category: "changed_pricing_model",
    message: msg({ subject: "Your Spotify receipt", sender: "no-reply@spotify.com", bodyText: "Promo applied. Billed $9.99 today, renews 2026-10-10." }),
    priorSubscription: priorUsd("Spotify", 10.99, "MONTHLY"),
    extraction: ext({ vendor: "Spotify", priceAmount: 9.99, confidence: 0.87 }),
    expectedOutcome: "price_changed",
    notes: "Price decrease via promo.",
  },
  {
    id: "pricing-03",
    category: "changed_pricing_model",
    message: msg({ subject: "Your Adobe receipt", sender: "billing@adobe.com", bodyText: "You downgraded to the single-app plan. Billed $34.99 today, renews 2026-10-10." }),
    priorSubscription: priorUsd("Adobe", 54.99, "MONTHLY"),
    extraction: ext({ vendor: "Adobe", priceAmount: 34.99, confidence: 0.86 }),
    expectedOutcome: "price_changed",
    notes: "Plan downgrade.",
  },
  {
    id: "pricing-04",
    category: "changed_pricing_model",
    message: msg({ subject: "Your Dropbox receipt", sender: "billing@dropbox.com", bodyText: "You switched to the annual plan. Billed $119.88 today, renews 2027-10-10." }),
    priorSubscription: priorUsd("Dropbox", 11.99, "MONTHLY"),
    extraction: ext({ vendor: "Dropbox", priceAmount: 119.88, billingCycle: "annual", renewalDate: new Date("2027-10-10"), confidence: 0.87 }),
    expectedOutcome: "price_changed",
    notes: "Monthly-to-annual switch; billingCycle-update check again.",
  },
  {
    id: "pricing-05",
    category: "changed_pricing_model",
    message: msg({ subject: "Your YouTube Premium receipt", sender: "no-reply@youtube.example", bodyText: "You upgraded to the family plan. Billed $22.99 today, renews 2026-10-10." }),
    priorSubscription: priorUsd("YouTube Premium", 13.99, "MONTHLY"),
    extraction: ext({ vendor: "YouTube Premium", priceAmount: 22.99, confidence: 0.85 }),
    expectedOutcome: "price_changed",
    notes: "Individual-to-family upgrade.",
  },
  {
    id: "pricing-06",
    category: "changed_pricing_model",
    message: msg({ subject: "Your Notion receipt", sender: "billing@makenotion.com", bodyText: "You switched to annual billing. Billed $96.00 today, renews 2027-10-10." }),
    priorSubscription: priorUsd("Notion", 8, "MONTHLY"),
    extraction: ext({ vendor: "Notion", priceAmount: 96, billingCycle: "annual", renewalDate: new Date("2027-10-10"), confidence: 0.86 }),
    expectedOutcome: "price_changed",
    notes: "Monthly-to-annual switch.",
  },
  {
    id: "pricing-07",
    category: "changed_pricing_model",
    message: msg({ subject: "Your Peloton App receipt", sender: "no-reply@onepeloton.example", bodyText: "You downgraded to app-only. Billed $12.99 today, renews 2026-10-10." }),
    priorSubscription: priorUsd("Peloton App", 44, "MONTHLY"),
    extraction: ext({ vendor: "Peloton App", priceAmount: 12.99, confidence: 0.85 }),
    expectedOutcome: "price_changed",
    notes: "Downgrade from all-access to app-only.",
  },
  {
    id: "pricing-08",
    category: "changed_pricing_model",
    message: msg({ subject: "Your Xbox Game Pass receipt", sender: "billing@microsoft.com", bodyText: "You upgraded to Ultimate. Billed $16.99 today, renews 2026-10-10." }),
    priorSubscription: priorUsd("Xbox Game Pass", 10.99, "MONTHLY"),
    extraction: ext({ vendor: "Xbox Game Pass", priceAmount: 16.99, confidence: 0.86 }),
    expectedOutcome: "price_changed",
    notes: "Tier upgrade.",
  },
  {
    id: "pricing-09",
    category: "changed_pricing_model",
    message: msg({ subject: "Your Audible receipt", sender: "billing@audible.example", bodyText: "You switched to annual billing. Billed $149.50 today, renews 2027-10-10." }),
    priorSubscription: priorUsd("Audible", 14.95, "MONTHLY"),
    extraction: ext({ vendor: "Audible", priceAmount: 149.5, billingCycle: "annual", renewalDate: new Date("2027-10-10"), confidence: 0.86 }),
    expectedOutcome: "price_changed",
    notes: "Monthly-to-annual switch.",
  },
  {
    id: "pricing-10",
    category: "changed_pricing_model",
    message: msg({ subject: "Your Canva Pro receipt", sender: "billing@canva.com", bodyText: "You switched to annual billing. Billed $119.99 today, renews 2027-10-10." }),
    priorSubscription: priorUsd("Canva", 12.99, "MONTHLY"),
    extraction: ext({ vendor: "Canva", priceAmount: 119.99, billingCycle: "annual", renewalDate: new Date("2027-10-10"), confidence: 0.86 }),
    expectedOutcome: "price_changed",
    notes: "Monthly-to-annual switch.",
  },
  {
    id: "pricing-11",
    category: "changed_pricing_model",
    message: msg({ subject: "Your HelloFresh receipt", sender: "billing@hellofresh.example", bodyText: "You reduced your box size. Billed $52.00 today, renews 2026-09-17." }),
    priorSubscription: priorUsd("HelloFresh", 65, "WEEKLY"),
    extraction: ext({ vendor: "HelloFresh", priceAmount: 52, billingCycle: "weekly", renewalDate: new Date("2026-09-17"), confidence: 0.85 }),
    expectedOutcome: "price_changed",
    notes: "Fewer meals per box, same weekly cadence.",
  },
  {
    id: "pricing-12",
    category: "changed_pricing_model",
    message: msg({ subject: "Your PlayStation Plus receipt", sender: "billing@playstation.example", bodyText: "You upgraded to Extra. Billed $17.99 today, renews 2026-10-10." }),
    priorSubscription: priorUsd("PlayStation Plus", 9.99, "MONTHLY"),
    extraction: ext({ vendor: "PlayStation Plus", priceAmount: 17.99, confidence: 0.86 }),
    expectedOutcome: "price_changed",
    notes: "Tier upgrade.",
  },
  {
    id: "pricing-13",
    category: "changed_pricing_model",
    message: msg({ subject: "Your LinkedIn Premium receipt", sender: "billing@linkedin.example", bodyText: "You switched to annual billing. Billed $239.88 today, renews 2027-10-10." }),
    priorSubscription: priorUsd("LinkedIn Premium", 29.99, "MONTHLY"),
    extraction: ext({ vendor: "LinkedIn Premium", priceAmount: 239.88, billingCycle: "annual", renewalDate: new Date("2027-10-10"), confidence: 0.85 }),
    expectedOutcome: "price_changed",
    notes: "Monthly-to-annual switch.",
  },
  {
    id: "pricing-14",
    category: "changed_pricing_model",
    message: msg({ subject: "Your Grammarly receipt", sender: "billing@grammarly.com", bodyText: "You switched to annual billing. Billed $144.00 today, renews 2027-10-10." }),
    priorSubscription: priorUsd("Grammarly", 12, "MONTHLY"),
    extraction: ext({ vendor: "Grammarly", priceAmount: 144, billingCycle: "annual", renewalDate: new Date("2027-10-10"), confidence: 0.86 }),
    expectedOutcome: "price_changed",
    notes: "Monthly-to-annual switch.",
  },
  {
    id: "pricing-15",
    category: "changed_pricing_model",
    message: msg({ subject: "Your Duolingo Plus receipt", sender: "no-reply@duolingo.example", bodyText: "Your region has changed. Billed CAD 6.99 today, renews 2026-10-10." }),
    priorSubscription: priorUsd("Duolingo Plus", 6.99, "MONTHLY"),
    extraction: ext({ vendor: "Duolingo Plus", priceAmount: 6.99, currency: "CAD", confidence: 0.9 }),
    expectedOutcome: "pending_review",
    notes: "Same-looking amount, but billing currency silently shifted from USD to CAD alongside a 'pricing changed' framing — must never auto-merge across currencies, so this is forced to review just like a plain currency switch.",
  },
  {
    id: "pricing-16",
    category: "changed_pricing_model",
    message: msg({ subject: "Your Squarespace receipt", sender: "billing@squarespace.com", bodyText: "Your plan changed. See your account for details." }),
    priorSubscription: priorUsd("Squarespace", 16, "MONTHLY"),
    extraction: ext({ vendor: "Squarespace", priceAmount: 0, currency: "USD", renewalDate: null, billingCycle: "unknown", confidence: 0.4 }),
    expectedOutcome: "pending_review",
    notes: "Extraction glitch: 'your plan changed' notice with no digits to extract — price missing forces review rather than wiping out the existing price.",
  },
];

// ---------------------------------------------------------------------------------------
// Category 6: Partial renewal notices — a prior subscription exists; the new email is a
// reminder that omits price, date, or currency, or is a plain duplicate/genuine renewal
// for contrast. 16 examples.
// ---------------------------------------------------------------------------------------

export const PARTIAL_RENEWAL_NOTICES: AdversarialFixture[] = [
  {
    id: "partial-01",
    category: "partial_renewal_notice",
    message: msg({ subject: "Your Netflix renews soon", sender: "info@netflix.com", bodyText: "Your subscription renews in 3 days." }),
    priorSubscription: priorUsd("Netflix", 15.49, "MONTHLY"),
    extraction: ext({ vendor: "Netflix", priceAmount: 0, currency: "USD", renewalDate: null, billingCycle: "unknown", confidence: 0.5 }),
    expectedOutcome: "pending_review",
    notes: "No price restated — missing price always forces review.",
  },
  {
    id: "partial-02",
    category: "partial_renewal_notice",
    message: msg({ subject: "Your Spotify subscription renews soon", sender: "no-reply@spotify.com", bodyText: "Your subscription will renew soon." }),
    priorSubscription: priorUsd("Spotify", 10.99, "MONTHLY"),
    extraction: ext({ vendor: "Spotify", priceAmount: 0, currency: "USD", renewalDate: null, billingCycle: "unknown", confidence: 0.45 }),
    expectedOutcome: "pending_review",
    notes: "No price, no date.",
  },
  {
    id: "partial-03",
    category: "partial_renewal_notice",
    message: msg({ subject: "Your Amazon Prime renewal reminder", sender: "auto-confirm@amazon.com", bodyText: "Your membership renews on 2026-10-10." }),
    priorSubscription: priorUsd("Amazon Prime", 14.99, "MONTHLY"),
    extraction: ext({ vendor: "Amazon Prime", priceAmount: 0, currency: "USD", renewalDate: new Date("2026-10-10"), billingCycle: "unknown", confidence: 0.55 }),
    expectedOutcome: "pending_review",
    notes: "Date present but price missing — still forces review.",
  },
  {
    id: "partial-04",
    category: "partial_renewal_notice",
    message: msg({ subject: "Reminder: your Hulu plan renews tomorrow", sender: "no-reply@hulu.example", bodyText: "Just a reminder your plan renews tomorrow." }),
    priorSubscription: priorUsd("Hulu", 7.99, "MONTHLY"),
    extraction: ext({ vendor: "Hulu", priceAmount: 0, currency: "USD", renewalDate: null, billingCycle: "unknown", confidence: 0.4 }),
    expectedOutcome: "pending_review",
    notes: "No numbers at all in the notice.",
  },
  {
    id: "partial-05",
    category: "partial_renewal_notice",
    message: msg({ subject: "Your Disney+ subscription", sender: "billing@disneyplus.example", bodyText: "Your plan is $13.99 per month. Thanks for being a subscriber." }),
    priorSubscription: priorUsd("Disney+", 13.99, "MONTHLY"),
    extraction: ext({ vendor: "Disney+", priceAmount: 13.99, currency: "USD", renewalDate: null, billingCycle: "monthly", confidence: 0.55 }),
    expectedOutcome: "pending_review",
    notes: "Price present but no renewal date — missing date independently forces review.",
  },
  {
    id: "partial-06",
    category: "partial_renewal_notice",
    message: msg({ subject: "Your Apple Music receipt", sender: "no_reply@apple.com", bodyText: "You were billed $10.99 today, renews 2026-09-10." }),
    priorSubscription: priorUsd("Apple Music", 10.99, "MONTHLY", new Date("2026-09-10")),
    extraction: ext({ vendor: "Apple Music", priceAmount: 10.99, renewalDate: new Date("2026-09-10"), confidence: 0.9 }),
    expectedOutcome: "duplicate",
    notes: "Same price and same period as the existing record — a resend/reminder for the same billing period, correctly a no-op.",
  },
  {
    id: "partial-07",
    category: "partial_renewal_notice",
    message: msg({ subject: "Your YouTube Premium renewal", sender: "no-reply@youtube.example", bodyText: "You'll be charged the usual amount on your renewal date." }),
    priorSubscription: priorUsd("YouTube Premium", 13.99, "MONTHLY"),
    extraction: ext({ vendor: "YouTube Premium", priceAmount: 0, currency: "USD", renewalDate: null, billingCycle: "unknown", confidence: 0.5 }),
    expectedOutcome: "pending_review",
    notes: "'The usual amount' has no digits to extract.",
  },
  {
    id: "partial-08",
    category: "partial_renewal_notice",
    message: msg({ subject: "Your Peloton renewal notice", sender: "no-reply@onepeloton.example", bodyText: "You were billed $44.00 today, renews 2032-09-10." }),
    priorSubscription: priorUsd("Peloton", 44, "MONTHLY"),
    extraction: ext({ vendor: "Peloton", priceAmount: 44, renewalDate: null, confidence: 0.6 }),
    expectedOutcome: "pending_review",
    notes: "The stated date (2032, 6 years out) is implausible and is rejected by parseRenewalDate before this fixture is even built (renewalDate is null here to mirror that) — missing date forces review.",
  },
  {
    id: "partial-09",
    category: "partial_renewal_notice",
    message: msg({ subject: "About your Audible membership", sender: "no-reply@audible.example", bodyText: "Your membership continues. Thanks for being a member." }),
    priorSubscription: priorUsd("Audible", 14.95, "MONTHLY"),
    extraction: ext({
      vendor: "Audible",
      priceAmount: 0,
      currency: "USD",
      renewalDate: null,
      billingCycle: "unknown",
      confidence: 0.35,
    }),
    expectedOutcome: "pending_review",
    notes: "Generic marketing-adjacent notice, low self-reported confidence and nothing concrete to extract.",
  },
  {
    id: "partial-10",
    category: "partial_renewal_notice",
    message: msg({ subject: "Your Grammarly renewal reminder", sender: "billing@grammarly.com", bodyText: "You were billed $12.00 today, renews 2026-09-10." }),
    priorSubscription: priorUsd("Grammarly", 12, "MONTHLY", new Date("2026-09-10")),
    extraction: ext({ vendor: "Grammarly", priceAmount: 12, renewalDate: new Date("2026-09-10"), confidence: 0.9 }),
    expectedOutcome: "duplicate",
    notes: "Genuine duplicate reminder for the same period.",
  },
  {
    id: "partial-11",
    category: "partial_renewal_notice",
    message: msg({ subject: "Your LinkedIn Premium receipt", sender: "billing@linkedin.example", bodyText: "You were billed $29.99 today, renews 2026-11-10." }),
    priorSubscription: priorUsd("LinkedIn Premium", 29.99, "MONTHLY"),
    extraction: ext({ vendor: "LinkedIn Premium", priceAmount: 29.99, renewalDate: new Date("2026-11-10"), confidence: 0.9 }),
    expectedOutcome: "renewed",
    notes: "Clean positive-control case: same price, later date.",
  },
  {
    id: "partial-12",
    category: "partial_renewal_notice",
    message: msg({ subject: "Your Notion renewal", sender: "billing@makenotion.com", bodyText: "You were billed 8.00 today, renews 2026-10-10." }),
    priorSubscription: priorUsd("Notion", 8, "MONTHLY"),
    extraction: ext({ vendor: "Notion", priceAmount: 8, currency: "", renewalDate: new Date("2026-10-10"), confidence: 0.6 }),
    expectedOutcome: "pending_review",
    notes: "Currency omitted from the email entirely — an empty/invalid currency fails the ISO 4217 guard.",
  },
  {
    id: "partial-13",
    category: "partial_renewal_notice",
    message: msg({ subject: "Your Xbox Game Pass renewal", sender: "billing@microsoft.com", bodyText: "Your card ending in 4242 will be charged on your renewal date." }),
    priorSubscription: priorUsd("Xbox Game Pass", 10.99, "MONTHLY"),
    extraction: ext({ vendor: "Xbox Game Pass", priceAmount: 0, currency: "USD", renewalDate: null, billingCycle: "unknown", confidence: 0.5 }),
    expectedOutcome: "pending_review",
    notes: "Card-ending notice with no charge amount.",
  },
  {
    id: "partial-14",
    category: "partial_renewal_notice",
    message: msg({ subject: "Your PlayStation Plus renewal notice", sender: "billing@playstation.example", bodyText: "You were billed $17.99 today, renews 2026-10-10." }),
    priorSubscription: priorUsd("PlayStation Plus", 9.99, "MONTHLY"),
    extraction: ext({ vendor: "PlayStation Plus", priceAmount: 17.99, renewalDate: new Date("2026-10-10"), confidence: 0.87 }),
    expectedOutcome: "price_changed",
    notes: "Framed as a routine renewal notice but is actually a price increase — matching logic must catch this regardless of subject framing.",
  },
  {
    id: "partial-15",
    category: "partial_renewal_notice",
    message: msg({
      subject: "Re: Fwd: Your Squarespace renewal",
      sender: "billing@squarespace.com",
      bodyText: "> Forwarded message >\nYou were billed $16.00 today, renews 2026-09-10.",
    }),
    priorSubscription: priorUsd("Squarespace", 16, "MONTHLY", new Date("2026-09-10")),
    extraction: ext({ vendor: "Squarespace", priceAmount: 16, renewalDate: new Date("2026-09-10"), confidence: 0.85 }),
    expectedOutcome: "duplicate",
    notes: "Threaded/forwarded quote of the original receipt; same period, correctly a no-op despite the noisy subject/body.",
  },
  {
    id: "partial-16",
    category: "partial_renewal_notice",
    message: msg({ subject: "Your HelloFresh renewal", sender: "billing@hellofresh.example", bodyText: "Your box price varies by order. Delivery scheduled for 2026-09-17." }),
    priorSubscription: priorUsd("HelloFresh", 65, "WEEKLY"),
    extraction: ext({ vendor: "HelloFresh", priceAmount: 0, currency: "USD", renewalDate: new Date("2026-09-17"), billingCycle: "weekly", confidence: 0.55 }),
    expectedOutcome: "pending_review",
    notes: "'Varies by order' has no fixed amount to extract.",
  },
];

export const ADVERSARIAL_FIXTURES: AdversarialFixture[] = [
  ...AMBIGUOUS_INVOICES,
  ...TRIAL_SUBSCRIPTIONS,
  ...INTERNATIONAL_CURRENCIES,
  ...MIXED_LANGUAGE,
  ...CHANGED_PRICING_MODELS,
  ...PARTIAL_RENEWAL_NOTICES,
];
