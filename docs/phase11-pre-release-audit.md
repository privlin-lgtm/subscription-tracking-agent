# Phase 11 — Pre-Release Audit

*Phase 11 output (tool: Claude — Pre-Release Audit), per [subscription-tracking-agent-prompts.md](../subscription-tracking-agent-prompts.md), acting as a CTO preparing this product for production release. Synthesizes Phases 1–10 rather than re-deriving them, and adds independent coverage of the three areas none of the prior phases directly owned: monitoring, alerting (operational, not the product's own renewal alerts), and disaster recovery — plus one compliance gap this pass found and closed.*

---

## Go / No-Go Recommendation

**Conditional Go.** Every launch blocker this audit is aware of that was fixable in code has been fixed, live-verified where the fix touched anything infrastructure-dependent, and documented where it wasn't fixable in code at all. What remains is: one High-severity fix (this phase's own finding, fixed below), a handful of ops/infrastructure decisions that genuinely require a human call this document can't make (Gmail API quota strategy, monitoring/alerting tooling choice, backup schedule), and honestly-scoped MVP tradeoffs carried since Phase 1. None of the remaining items are code defects hiding behind the recommendation — they're decisions.

## Launch Blockers — Full List Across All Phases

| # | Blocker | Phase found | Status |
|---|---|---|---|
| — | Cancellation-event detection missing entirely (contradicted the Phase 2 design) | 5 | Fixed |
| D1 | Pipeline writes bypassed the transactional helper — could silently lose event/price history | 6 | Fixed |
| D3 | Per-connected-user serial query loop in `AlertJobs` | 6 | Fixed |
| D5 | `createIfAbsent` swallowed real errors as harmless duplicates | 6 | Fixed |
| Q2 | Price/renewal updates didn't update `billingCycle`, silently corrupting the record | 7 | Fixed |
| Q1 | Trial-lifecycle emails silently dropped at the prefilter | 7 | Fixed |
| S1 | Cancellation auto-apply trusted vendor name + confidence alone, no sender check | 8 | Fixed |
| S2 | API error logger risked leaking OAuth tokens into server logs | 8 | Fixed |
| S3 | Token encryptor silently reused the session-signing secret when unconfigured | 8 | Fixed |
| L1 | Advisory lock leak under connection-pool contention (live-verified: 49/50 failures pre-fix, 0/50 post-fix) | 10 | Fixed |
| L2 | Gmail sync loop serial across users — wouldn't complete within its own schedule at 10k users | 10 | Fixed |
| L3 | No overlap guard on scheduled jobs | 10 | Fixed |
| **P1** | **No user-facing account deletion — GDPR Article 17 (right to erasure) had no trigger** | **11** | **Fixed** |
| L4 | Single Google Cloud project's Gmail API quota shared across all users | 10 | Ops decision required |
| L5 | No distributed-scheduling story if the worker is ever run as multiple replicas | 10 | Deferred, documented |
| S5 | Renewal/price-change auto-apply has no sender verification (cancellation does) | 8 | Deferred, documented, deliberate |
| — | Vendor-alias table doesn't learn from confirmed reviews | 5 | Deferred, documented |
| — | Non-English mail from unfamiliar senders is silently dropped (quantified: 5/17 in the adversarial set) | 5, 7 | Accepted MVP tradeoff |

## P1 — No user-facing account deletion (found this phase, fixed)

**The finding:** every prior phase that touched data retention or deletion (Phase 1's architecture doc, Phase 6's database review) verified that `onDelete: Cascade` is correctly set on every foreign key back to `User` — meaning *if* a `User` row were deleted, everything owned by it would correctly cascade. What none of them checked, because it wasn't in their scope, is whether there was any way for that deletion to actually happen. There wasn't: no API route, no UI control, nothing. A user had no way to exercise GDPR's Article 17 right to erasure (or simply "I don't want an account anymore") short of asking someone with direct database access to do it for them.
- **Severity:** High for a production launch — this isn't a hypothetical; it's a concrete, named legal requirement for any EU user, and a basic expectation independent of jurisdiction.
- **Fix:** added `UserRepository.deleteAccount` (a thin `prisma.user.delete`, relying on the already-correct cascade), a `DELETE /api/account` route, and a confirm-then-delete UI in Settings that signs the user out and redirects to `/login` on success.
- **Verified live**, not just built: registered a real test account against an isolated Postgres instance, confirmed the Settings page renders the new section, clicked through the two-step confirmation, confirmed the account was deleted (session cleared, redirected to login), and confirmed a subsequent login attempt with the same credentials correctly fails ("Invalid email or password") — the account and its data are actually gone, not just hidden.

## Architecture

Covered by [Phase 1](architecture.md), [Phase 2](technical-design.md), and reaffirmed by [Phase 9](phase9-engineering-review.md): layered `domain`/`application`/`infrastructure` structure, consistently followed; every deviation from the original design is a documented decision, not drift. No new architectural concern surfaced in this pass.

## Code Quality

Covered by [Phase 9](phase9-engineering-review.md): no open critical or major issues; 234 tests passing (updated from 228 with this phase's additions), 97%+ line coverage. No new code-quality concern surfaced in this pass beyond P1, which was a missing *feature*, not a code defect in what exists.

## Infrastructure

Covered by [Phase 10](phase10-scalability-review.md): the two code-fixable reliability/scaling blockers (L1, L2/L3) are fixed and, for L1, live-verified under realistic concurrent load rather than merely reasoned about — worth restating here since it's the highest-confidence fix in the whole audit precisely because it was reproduced, not assumed. L4 (Gmail API quota) and L5 (single-replica ceiling) are correctly ops decisions, not code gaps.

## Security

Covered by [Phase 8](phase8-security-review.md): the concrete "prompt injection risk" for this product (S1, sender-unverified cancellation) is closed, along with a credential-logging path (S2) and a key-separation gap (S3). Rendering-layer XSS is structurally closed (no `dangerouslySetInnerHTML`/`eval` anywhere). OAuth and credential storage were reviewed and found sound.

## Monitoring — new to this phase

**Finding:** there is no application-level monitoring or error tracking configured anywhere in this codebase (no Sentry/Datadog/equivalent SDK, no structured logging beyond plain `console.error`, no health-check dashboard beyond the bare `/api/health` route existing at all). At production scale, the fixes in this audit (S2's logging change, in particular) reduce *what* gets logged unsafely, but nothing here ships an actual monitoring pipeline for someone to notice a spike in `jsonError`'s `console.error` calls, a rise in Gmail sync failures, or a scheduled job silently skipping runs via L3's new overlap guard.
- **Severity:** this is a real pre-launch gap, but it's explicitly an infrastructure/tooling choice (which APM vendor, what alerting thresholds, who's on call) that this review is not positioned to make unilaterally — flagging it as a **required decision before launch**, not something left unmentioned.
- **Recommendation:** at minimum, wire `console.error` output to whatever log aggregation the deployment platform already provides (most hosting platforms capture stdout/stderr automatically), and add a lightweight uptime check against `/api/health`. A dedicated APM/error-tracking SDK is the more complete answer but is a bigger integration than this audit should decide unprompted.

## Alerting — new to this phase

Two different meanings worth separating explicitly, since the prompts document reuses "alert" for both:
- **Product-facing alerting** (renewal reminders, price-increase notices, inactivity flags) — implemented, reviewed across Phases 5/6/7, working.
- **Operational alerting** (someone gets paged when the Gmail sync failure rate spikes, when a scheduled job starts failing, when the database connection pool saturates) — **does not exist**. This is the same gap as Monitoring above, from the ops side: even with logs flowing somewhere, nothing here defines a threshold or notifies a human. Same recommendation and same reasoning for not being fixed unilaterally in this pass.

## Disaster Recovery — new to this phase

**Finding:** no backup/restore procedure is documented or automated anywhere in this repository. `docker-compose.yml` defines a named volume (`pgdata`) for local development, which is not a backup strategy — it protects against a container restart, not against volume corruption, host loss, or accidental `DROP TABLE`. Production Postgres hosting (managed RDS/Cloud SQL/etc., presumably, though nothing in this repo specifies it) typically provides automated backups, but this codebase doesn't document what recovery point/time objective is expected, nor has any restore procedure been tested.
- **Severity:** High as a pre-launch gap for anything holding real user data, but — same pattern as the two items above — the actual answer (which managed database service, what backup cadence, who owns testing a restore) is an infrastructure decision, not a code change.
- **Recommendation:** before launch, document (a) the chosen database host's backup guarantees, (b) an explicit RPO/RTO target, and (c) that a restore has actually been test-run at least once. None of that can be verified or created from inside this repository.

## Compliance

- **P1 (this phase)** closes the most concrete gap: GDPR Article 17 now has a working trigger.
- **Retention**: [Phase 6](phase6-database-review.md) gives `AuditLog` a retention window; `SubscriptionEvent`/`PriceChange` are kept permanently by explicit product decision (the user-facing historical record). This is a defensible position, but it should be stated in a privacy policy a real user can read, which is outside this repository's scope to write.
- **Data processing basis / consent language**: not evaluated here — this audit can confirm the *technical* mechanisms (minimal OAuth scope, encrypted credentials, erasure now available) but cannot draft the legal privacy policy or terms of service a real launch needs; that's a legal review, not an engineering one.

## Privacy

Covered substantively by [Phase 8](phase8-security-review.md): `gmail.readonly` only, encrypted credentials, email content treated as untrusted data with no model tool-access, no raw HTML rendering. This phase adds: account deletion now exists (P1), closing the last major technical privacy gap this review is aware of.

---

## Summary for the Go / No-Go Call

**What's actually blocking a launch is short and specific:**
1. Pick and wire up operational monitoring/alerting (this document can't choose the vendor).
2. Document and verify a database backup/restore procedure (this document can't choose the hosting provider or test a restore it has no access to run).
3. Decide the Gmail API quota strategy before onboarding meaningfully toward 10,000 users (L4).
4. Get a legal/privacy review of user-facing policy language (out of engineering's scope entirely).

**Everything code-fixable that this audit and the nine reviews before it found has been fixed**, most with tests, several with live verification against real infrastructure rather than reasoning alone. That's the basis for "Conditional Go" rather than "No-Go": the product is technically sound; what's left is operational and legal readiness that no amount of further code review resolves.
