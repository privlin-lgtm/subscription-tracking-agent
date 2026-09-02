# Subscription Tracking Agent — Technical Specification

*Phase 1 output: Initial Architecture Design + Architecture Review, per [subscription-tracking-agent-prompts.md](../subscription-tracking-agent-prompts.md).*

---

## 1. System Architecture

```
                         ┌───────────────────────┐
                         │   Gmail (user inbox)   │
                         └───────────┬───────────┘
                                     │ OAuth 2.0 (read-only, gmail.readonly)
                                     ▼
                    ┌────────────────────────────────┐
                    │        Gmail Sync Service        │
                    │  - incremental sync (historyId)  │
                    │  - message filtering / dedup      │
                    │  - rate-limit / backoff handling  │
                    └───────────────┬────────────────┘
                                     │ raw message (subject, sender, body, headers)
                                     ▼
                    ┌────────────────────────────────┐
                    │   Extraction Agent (LLM-backed)  │
                    │  - classify: is this subscription-│
                    │    related?                       │
                    │  - extract vendor/price/currency/ │
                    │    billing cycle/renewal date      │
                    │  - confidence scoring              │
                    └───────────────┬────────────────┘
                                     │ structured JSON (candidate record)
                                     ▼
                    ┌────────────────────────────────┐
                    │     Normalization & Matching     │
                    │  - vendor name normalization      │
                    │  - currency normalization          │
                    │  - dedup against existing records │
                    │  - merge vs. new-subscription logic│
                    └───────────────┬────────────────┘
                                     │
                                     ▼
                    ┌────────────────────────────────┐
                    │      Persistence Layer (DB)      │
                    │  - subscriptions                  │
                    │  - subscription_events (history)  │
                    │  - price_changes                  │
                    │  - audit_log                       │
                    └───────────────┬────────────────┘
                                     │
                       ┌─────────────┴─────────────┐
                       ▼                             ▼
          ┌─────────────────────┐        ┌─────────────────────┐
          │  Alert Scheduler /   │        │   Reporting / API    │
          │  Background Jobs     │        │   Layer (Next.js)    │
          │  - renewal reminders │        │  - dashboard          │
          │  - price-increase    │        │  - subscription list  │
          │    detection          │        │  - notifications feed │
          │  - inactivity scan    │        └─────────────────────┘
          └─────────────────────┘
```

**Components**

| Component | Responsibility |
|---|---|
| Gmail Sync Service | OAuth token lifecycle, incremental sync via Gmail `history.list`, message-level filtering (skip obviously irrelevant mail before it reaches the LLM) |
| Extraction Agent | LLM call(s) that classify and extract structured subscription data from a single email |
| Normalization & Matching | Deterministic (non-LLM) logic that canonicalizes vendor names/currencies and decides new-vs-update-vs-duplicate |
| Persistence Layer | PostgreSQL via Prisma; source of truth for subscriptions and their history |
| Alert Scheduler | Background jobs (cron/queue) that scan for upcoming renewals, detected price increases, and inactive subscriptions |
| Reporting/API | Next.js app serving the dashboard and notification surface |

---

## 2. Data Model

```
User
 - id
 - email
 - gmail_oauth_token (encrypted, refresh token only)
 - created_at

Subscription
 - id
 - user_id (FK)
 - vendor_normalized        -- canonical name, e.g. "Netflix"
 - vendor_raw                -- as seen in email, for audit
 - status                    -- active | canceled | inactive | pending_review
 - price_amount
 - price_currency
 - billing_cycle             -- monthly | annual | weekly | custom
 - next_renewal_date
 - last_seen_email_id
 - confidence_score
 - created_at / updated_at

SubscriptionEvent            -- append-only history
 - id
 - subscription_id (FK)
 - event_type                -- created | renewed | price_changed | canceled | flagged_inactive
 - source_email_id
 - payload (jsonb)           -- raw extraction snapshot at time of event
 - created_at

PriceChange
 - id
 - subscription_id (FK)
 - old_amount / new_amount
 - currency
 - detected_at
 - source_email_id

ProcessedEmail                -- idempotency / dedup ledger
 - id
 - user_id (FK)
 - gmail_message_id (unique per user)
 - gmail_history_id
 - classification             -- subscription | not_subscription | ambiguous
 - processed_at

AuditLog
 - id
 - user_id (FK)
 - action
 - actor                      -- system | user
 - details (jsonb)
 - created_at
```

Key design choices:
- **`SubscriptionEvent` is append-only** — the current `Subscription` row is a projection/cache of the latest event, so renewal/price history is never lost and is independently auditable.
- **`ProcessedEmail` is the idempotency boundary** — every Gmail message is processed at most once per user, keyed on `gmail_message_id`, so re-syncs and retries are safe.
- Money is stored as integer minor units (cents) with a separate currency code, never floats.

---

## 3. Agent Workflow

1. **Sync**: Gmail Sync Service pulls new/changed messages since the last stored `historyId`.
2. **Pre-filter**: cheap heuristic filter (sender domain allowlist patterns, keyword match on subject/snippet) discards obviously irrelevant mail *before* it reaches the LLM, to control cost.
3. **Classify + Extract**: Extraction Agent receives subject, sender, and body (HTML stripped to text) and returns structured JSON: `{ is_subscription, vendor, price, currency, billing_cycle, renewal_date, confidence }`.
4. **Threshold gate**: results below a confidence threshold are routed to a `pending_review` queue instead of auto-applied.
5. **Normalize**: vendor name mapped to a canonical entry (lookup table + fuzzy match fallback); currency normalized to ISO 4217.
6. **Match**: compare against existing subscriptions for this user (vendor + approximate price) to decide: new subscription, renewal of existing, price change, or duplicate receipt (no-op).
7. **Persist**: write `Subscription` (upsert), append `SubscriptionEvent`, and `PriceChange` if applicable, inside a single transaction.
8. **Schedule**: Alert Scheduler evaluates renewal reminders, price-increase alerts, and inactivity (no renewal-consistent activity for N cycles) on a recurring background job, independent of the sync path.

---

## 4. Required APIs

- **Gmail API** — `users.messages.list`, `users.messages.get`, `users.history.list`, OAuth 2.0 with `gmail.readonly` scope only.
- **LLM provider** — OpenAI-compatible chat/completions endpoint with structured/JSON output mode, used solely for classification+extraction (not for any user-facing chat).
- **Internal API (Next.js route handlers)** — subscription CRUD/read, notification feed, manual review/correction endpoints, OAuth callback.
- **Currency reference data** — static/periodically-updated ISO 4217 currency table (no live FX conversion in MVP — see Section 7).

---

## 5. Failure Cases

| Failure | Handling |
|---|---|
| Gmail token expired/revoked | Detect on 401, mark integration `disconnected`, notify user to re-auth; stop background jobs for that user |
| Gmail rate limit (429) | Exponential backoff with jitter, respect `Retry-After`, resumable via stored `historyId` |
| `historyId` too old / gone (Gmail purges history) | Fall back to full re-sync within a bounded lookback window (e.g., last 12 months) |
| LLM extraction failure / malformed JSON | Retry once with stricter schema prompt; on repeated failure, route to `pending_review` rather than dropping the email |
| Ambiguous/low-confidence extraction | Route to `pending_review`, never silently auto-create/update a subscription |
| Duplicate receipt for same billing period | Detected via `ProcessedEmail` + matching logic; recorded as event, not a new subscription |
| Vendor sends inconsistent naming (e.g. "Netflix" vs "NETFLIX.COM") | Canonicalization layer with normalization table + fallback fuzzy match, flagged for manual mapping if no match |
| Currency mismatch across renewals (vendor changes billing region) | Treated as a flagged price/currency change, not auto-merged silently |
| Background job overlap/double-run | Job locking (e.g., advisory lock per user) to prevent duplicate alerts |
| Partial pipeline failure mid-sync | Sync is checkpointed per message; a crash mid-batch resumes from last committed `historyId`, not from scratch |

---

## 6. Security Considerations

- **Least-privilege OAuth**: request `gmail.readonly` only; never request send/modify/delete scopes.
- **Encrypted token storage**: refresh tokens encrypted at rest (KMS-backed), never logged, never returned via API.
- **Prompt injection from email content**: email bodies are untrusted input to the LLM. The extraction prompt must treat email content strictly as data (not instructions), use a constrained output schema, and the system must never take actions (send email, modify data beyond the extraction write-path) based on instructions embedded in email content. See Phase 8 for dedicated testing.
- **PII minimization**: store only the fields needed for subscription tracking; avoid persisting full raw email bodies long-term (store a reference/snapshot with a retention limit instead, per data retention policy).
- **Access control**: all subscription data scoped strictly per authenticated user; no cross-user queries possible by construction (always filter by `user_id`).
- **Audit logging**: all state changes to subscriptions logged in `AuditLog` for traceability, without logging raw email content.
- **Transport/storage encryption**: TLS in transit, encryption at rest for the database.

---

## 7. MVP Scope

**In scope:**
- Gmail OAuth connect/disconnect, read-only sync
- Subscription detection + extraction for common billing email patterns (English-language, single currency per user is acceptable to start)
- New/renewal/price-change/duplicate handling
- Manual review queue for low-confidence extractions
- Renewal reminder notifications (in-app / email)
- Price-increase detection and flagging
- Basic dashboard: list of active subscriptions, spend summary, upcoming renewals

**Explicitly out of scope for MVP:**
- Live currency conversion / multi-currency spend rollups (store native currency only)
- Non-Gmail providers (Outlook, IMAP, etc.)
- Automatic cancellation actions (no write access to email or vendor accounts)
- Multi-language extraction beyond a small allowlisted set
- Team/shared inbox support (single-user accounts only)

---

## 8. Future Roadmap

1. Multi-currency support with live FX conversion for unified spend reporting.
2. Additional inbox providers (Outlook/IMAP via a provider-abstraction layer).
3. Inactive-subscription detection based on usage signals beyond email (e.g., optional integrations).
4. Suggested-action layer (e.g., "cancel" deep links) — still requiring explicit user action, never automated.
5. Team/family plan support with shared subscription visibility.
6. Historical spend analytics and budget forecasting.
7. Fine-tuned/smaller extraction model to reduce per-email LLM cost at scale.

---

## Architecture Review

*Acting as principal engineer, reviewing the design above.*

| # | Issue | Category | Severity |
|---|---|---|---|
| 1 | No explicit handling for Gmail's `historyId` expiry (Gmail only retains history for ~7 days); the design mentions a fallback but the bounded-lookback re-sync could be expensive/slow for high-volume inboxes on first recovery. | Gmail API limitation | **Medium** |
| 2 | LLM extraction is on the critical path for every candidate email — no caching/dedup *before* the LLM call beyond the cheap pre-filter. For high-volume inboxes this is the dominant cost driver and isn't bounded (no per-user rate/cost cap specified). | Cost | **High** |
| 3 | Prompt injection defense is described at a principle level ("treat as data") but the spec has no concrete mechanism (e.g., input sanitization, output schema validation, isolating the LLM from any tool/action capability). Needs a hard technical control, not just a policy statement. | Security | **High** |
| 4 | Vendor normalization relies on "a lookup table + fuzzy match fallback" with no specified conflict-resolution or human-in-the-loop path when fuzzy match confidence is itself low — risk of silently merging two distinct vendors (e.g., "Amazon Prime" vs "Amazon Music"). | Data quality | **Medium** |
| 5 | No mention of what happens to `pending_review` items — no UI/workflow described for a user to resolve them, so low-confidence emails could accumulate indefinitely with no closure path. | Missing requirement | **Medium** |
| 6 | Single-currency-per-user assumption in MVP is reasonable, but the data model already stores `price_currency` per subscription with no guard — a user with mixed-currency subscriptions (e.g., a US vendor billing in EUR) could produce a dashboard that silently sums incompatible currencies unless the reporting layer explicitly guards against it. This isn't called out as a UI/reporting-layer requirement. | Data quality / scalability | **Medium** |
| 7 | No specified retention/deletion policy despite Section 6 promising "a retention limit" — the actual retention period (raw snapshot TTL, right-to-delete flow) is undefined. This is a compliance gap, not just a technical one, if this ever handles EU users (GDPR right to erasure). | Security / compliance | **Medium** |
| 8 | Background job locking is mentioned ("advisory lock per user") but there's no described strategy for job scheduling infrastructure itself (cron vs. queue vs. worker pool), so it's unclear how this scales past a single-process deployment. | Scalability | **Low** |
| 9 | Confidence scoring is central to the whole pipeline's safety (gates auto-apply vs. review) but no calibration/validation strategy is defined — an uncalibrated LLM-reported confidence score is a known unreliable signal. | Data quality | **Medium** |
| 10 | No explicit statement on what OAuth scope is requested if the user later wants richer read access (e.g., to search more broadly) vs. the stated `gmail.readonly` minimalism — worth locking as a hard security invariant early, since scope creep here is the highest-consequence security decision in the whole system. | Security | **Low** (flagging for future discipline, not a current defect) |

**Summary**: The core architecture (sync → extract → normalize → persist → alert) is sound and appropriately separates the non-deterministic LLM step from deterministic matching/persistence logic — that boundary is the right call and should be preserved through implementation. The two issues worth resolving before Phase 2 technical design are **#2 (LLM cost control)** and **#3 (prompt injection needs a concrete mechanism, not a principle)**, since both affect the shape of the Extraction Agent's interface. Issues #5, #6, #7, and #9 should be resolved as explicit requirements before Phase 3 scaffolding, since they affect the data model and UI surface, not just implementation detail.
