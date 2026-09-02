# Phase 6 — Database Layer: Review

*Phase 6 review-section output, per [subscription-tracking-agent-prompts.md](../subscription-tracking-agent-prompts.md) ("Database Review"). Evaluates the implemented persistence layer — [prisma/schema.prisma](../prisma/schema.prisma), [src/infrastructure/db/repositories.ts](../src/infrastructure/db/repositories.ts), and its callers in [src/application](../src/application) — against normalization, scalability, query performance, historical tracking, data retention, and auditing capabilities.*

---

## Normalization

The schema is a clean, mostly-3NF design: append-only history lives in dedicated tables (`SubscriptionEvent`, `PriceChange`, `ReviewDecision`, `AuditLog`) rather than being bolted onto `Subscription` itself, and `VendorAlias` correctly factors vendor canonicalization out of the subscription row. `ReviewDecision` is a good addition beyond the original [Phase 2 technical design](technical-design.md) — it gives manual review outcomes their own historical record, separate from the generic `AuditLog`.

**One deliberate tradeoff worth naming, not fixing:** `Subscription` doubles as both the live subscription table and the `PENDING_REVIEW` candidate queue (via `status`, `confidenceScore`, `reviewReason`). This is a reasonable single-table design for this domain's scale, but it means every "my subscriptions" read must explicitly filter status — `PrismaSubscriptionRepository.listByUser` does this correctly (defaults to excluding only `DISMISSED`, i.e. still includes `PENDING_REVIEW` and `CANCELED` unless a status is passed), and callers must know to filter further (see Query Performance, below, for where that has a cost).

## Historical Tracking

**Finding D1 — The primary write path (the Gmail-driven pipeline) bypasses the transactional write helper, so a crash mid-sequence can silently break the append-only history guarantee.** `PrismaSubscriptionRepository.applyWrite` ([repositories.ts:88](../src/infrastructure/db/repositories.ts)) wraps a subscription create/update together with its events, price-change row, and audit entry in one `prisma.$transaction` — and `SubscriptionService.create/update/cancel` (the manual UI-driven CRUD path) correctly use it. But `SubscriptionPipelineService` — the automated path that processes every Gmail message — never calls `applyWrite`. Its price-change branch, for example ([subscription-pipeline.service.ts:200-220](../src/application/subscriptions/subscription-pipeline.service.ts)), issues four separate, non-transactional calls: `update()` (new price) → `appendEvent()` (`PRICE_CHANGED`) → `recordPriceChange()` → `notifications.createIfAbsent()`. A crash or connection drop after the first call leaves a subscription showing a new price with **no** corresponding `PriceChange` row and no `SubscriptionEvent` — a silent, permanent gap in exactly the history the schema was designed to make irrecoverable-proof. The same risk applies to the `create()` → `appendEvent()` pair on first-seen vendors, and to `handleCancellation`'s `update()` → `appendEvent()` pair.
- **Severity:** High
- **Confidence:** High (code-verified: `applyWrite` exists and is used by `subscription.service.ts` but grepping `subscription-pipeline.service.ts` shows no call to it — every pipeline write is a sequence of independent repository calls)
- **Recommendation:** route the pipeline's create/update/event/price-change/cancel writes through `applyWrite` the same way the manual CRUD path does. `processedEmails.record` and `notifications.createIfAbsent` can stay outside the transaction — calling them *after* a committed write is the safe order (worst case on a post-commit crash is a harmless re-processed message on next sync, versus today's silent, permanent loss of price/event history on a pre-commit crash).

## Data Retention Strategy

- `EmailSnapshot` has a working TTL + purge job (`expiresAt`, `AlertJobs.purgeExpiredSnapshots`) — **confirmed working as designed.**
- Full-account deletion cascades correctly: every foreign key back to `User` is `onDelete: Cascade` (the one intentional exception, `Notification.subscriptionId → onDelete: SetNull`, correctly lets notification history survive if a single subscription row were ever hard-deleted independent of the account) — **confirmed working as designed.**
- **Finding D2 — `AuditLog`, `SubscriptionEvent`, and `PriceChange` have no retention policy and grow unbounded for the life of an active account.** This isn't a new gap — it's the still-open half of [Phase 1 architecture-review finding #7](architecture.md#architecture-review) (deletion is solved; *retention while the account stays active* is not). For personal-scale usage this isn't urgent, but it should be closed with an explicit policy (even if the answer is "keep forever, it's small") before the Phase 8 security review, since "unbounded" isn't itself a decision.
- **Severity:** Low (accepted-scale risk today, but an explicit decision is still owed)
- **Confidence:** High

## Scalability

**Finding D3 — `AlertJobs` issues one database round-trip per connected user, in a serial loop, for both scheduled jobs.** `runRenewalReminders` and `runInactivityScan` ([alert.jobs.ts:23-84](../src/application/alerts/alert.jobs.ts)) both call `users.listConnectedUserIds()` and then `await` a separate `listDueRenewals`/`listStaleActive` query per user inside a `for` loop. At the scale explicitly named in the [Phase 1 architecture doc](architecture.md#8-future-roadmap) and [Phase 10 scalability review](../subscription-tracking-agent-prompts.md) (10,000 users), this is 10,000 sequential round trips per job run rather than a handful of set-based queries — the job's wall-clock time scales linearly with user count, and it's serial, not even concurrent.
- **Severity:** Medium (correct today at low user counts; becomes a real launch blocker at the scale the project has already committed to reviewing)
- **Confidence:** High (code-verified loop structure)
- **Recommendation:** either (a) replace the per-user loop with a single query across all connected users' subscriptions in the renewal/staleness window (`SubscriptionRepository.listDueRenewalsForUsers(userIds, from, to)`, backed by an index that leads with the filtered columns rather than `userId`), or, as a smaller first step, (b) run the existing per-user queries concurrently with a bounded concurrency limit instead of one `await` at a time — cheaper to ship, doesn't remove the round-trip count but removes the serial wall-clock multiplier.

## Query Performance

Index coverage generally matches the query shapes actually issued: `@@index([userId, status])`, `@@index([userId, vendorNormalized])`, and `@@index([userId, nextRenewalDate])` on `Subscription` cover `listByUser`, `findActiveByVendor`, and `listDueRenewals`/`listStaleActive` respectively. `SubscriptionEvent`, `PriceChange`, `AuditLog`, and `ReviewDecision` all index their natural `(parentId/userId, timestamp)` access pattern for their `list*` reads.

**Finding D4 — `spendSummary` fetches every non-dismissed subscription (including `CANCELED` and `PENDING_REVIEW`) and filters to `ACTIVE`/`INACTIVE` in application code.** `SubscriptionService.spendSummary` calls `listByUser(userId)` with no status argument, then `summarizeSpend` ([spend-summary.service.ts:29](../src/application/reporting/spend-summary.service.ts)) discards everything except `ACTIVE`/`INACTIVE`. This is because `SubscriptionRepository.listByUser` only accepts a single `SubscriptionStatus`, not a set — there's no way to ask the database for just the rows the report needs.
- **Severity:** Low (a growing-but-still-personal-scale table; not a correctness issue, `summarizeSpend`'s filter is correct)
- **Confidence:** High
- **Recommendation:** extend `listByUser` (or add a dedicated method) to accept `status: SubscriptionStatus[]` / a Prisma `{ in: [...] }` filter, so the spend report queries only the rows it totals.

## Auditing Capabilities

The audit trail is functionally complete end-to-end: `AuditRepository.listByUser` is backed by the `[userId, createdAt]` index, and it's actually surfaced to users via [/api/audit](../src/app/api/audit/route.ts) and an [audit page](../src/app/(app)/audit/page.tsx) — **confirmed working, not just written-and-forgotten.**

**Finding D5 — `NotificationRepository.createIfAbsent`'s idempotency check swallows every error as "already exists," not just the unique-constraint violation it's meant to catch.** ([repositories.ts:262](../src/infrastructure/db/repositories.ts)):
```ts
try {
  await prisma.notification.create({ data: input });
  return true;
} catch {
  return false;
}
```
This correctly no-ops on a duplicate `(userId, idempotencyKey)`, but it identically swallows a real failure — a dropped connection, a FK violation, a schema mismatch — and reports it back to every caller as a normal "this notification already existed" skip. Every caller (pipeline, review flow, alert jobs) treats a `false` return as benign, so a genuine write failure here is invisible; nothing surfaces it, nothing retries it, and the audit/notification trail silently has a hole.
- **Severity:** Medium
- **Confidence:** High (code-verified: the catch has no error-type check)
- **Recommendation:** check for Prisma's unique-constraint violation specifically (`error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"`) and rethrow anything else.

**Finding D6 (minor) — `listEvents`/`listPriceChanges` accept a bare `subscriptionId` with no `userId`, relying entirely on the calling service to authorize first.** Verified safe today: `SubscriptionService.getDetail` always calls the `userId`-scoped `get()` (which 404s on a non-owned id) before calling either method. But the repository contract itself doesn't enforce tenant isolation — a future direct caller of `listEvents`/`listPriceChanges` that skips the ownership check would silently leak another user's subscription history. `findActiveByVendor` and `listByUser`, by contrast, take `userId` directly and can't make this mistake.
- **Severity:** Low (no current exploit path; a defense-in-depth gap, not a live vulnerability)
- **Confidence:** Medium (depends on future code discipline, not a present defect)
- **Recommendation:** thread `userId` through `listEvents(userId, subscriptionId)` / `listPriceChanges(userId, subscriptionId)` and join through `Subscription.userId` in the query, so tenant isolation is structural rather than convention.

---

## Summary and Schema Improvements

| # | Finding | Area | Severity | Confidence |
|---|---|---|---|---|
| D1 | Pipeline writes bypass `applyWrite` — a mid-sequence crash can silently lose price/event history | Historical tracking | **High** | High |
| D3 | Per-connected-user serial query loop in `AlertJobs` — won't scale to the stated 10,000-user target | Scalability | Medium | High |
| D5 | `createIfAbsent` swallows real errors as harmless duplicates | Auditing / reliability | Medium | High |
| D2 | No retention policy for `AuditLog`/`SubscriptionEvent`/`PriceChange` (deletion is solved, retention isn't) | Data retention | Low | High |
| D4 | Spend summary over-fetches then filters in app code; `listByUser` can't filter by status set | Query performance | Low | High |
| D6 | History reads aren't `userId`-scoped at the repository layer | Auditing / normalization | Low | Medium |

**Recommended order:** D1 first — it's the one finding that undermines a guarantee the schema was explicitly built to provide, and it sits on the highest-traffic write path (every Gmail message). D3 matters before any real user-count growth but isn't urgent at current scale. D5 is a small, high-value fix (one error-type check). D2, D4, and D6 are reasonable to defer — none are incorrect today, they're each a small hardening pass once the higher-severity items are closed.

This is a review only; none of the above has been changed in this pass.
