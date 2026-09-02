# Subscription Tracking Agent

AI-powered subscription tracker that scans Gmail invoices and receipts to automatically discover, monitor, and analyze recurring subscriptions.

## Project Status

Phase 4 Gmail integration is in place: read-only OAuth with PKCE and signed state, encrypted refresh tokens, incremental `historyId` sync, rate-limit retries, and metadata-first filtering so only relevant messages are fully fetched.

Phase 5 subscription detection is designed, implemented, and validated: calibrated confidence scoring, vendor normalization with a fuzzy-match safety net, duplicate/renewal/price-change matching with a hard currency-mismatch guard, and cancellation-email detection that auto-cancels on high confidence or flags the existing subscription for review otherwise. See [docs/phase5-extraction-design.md](docs/phase5-extraction-design.md) and [docs/phase5-extraction-validation.md](docs/phase5-extraction-validation.md).

## Stack

- Next.js 15 (App Router) and TypeScript
- PostgreSQL and Prisma
- Auth.js credentials and Google Sign-In (passkey, PIN, 2FA, and other Google account methods)
- Gmail API (`gmail.readonly`)
- OpenAI-compatible LLM provider
- PostgreSQL advisory locks + `node-cron` worker

## Layout

```text
src/
  app/                         Next.js UI + HTTP adapters
  domain/                      entities, value objects, ports
  application/                 use cases (sync, extract, match, review, report, alerts)
  infrastructure/              Prisma, Gmail, LLM, crypto, jobs, Auth.js
  shared/                      config and reference data
prisma/                        schema, migration, vendor alias seed
docs/                          Phase 1 architecture and Phase 2 technical design
```

## Local setup

1. Copy `.env.example` to `.env` and set `AUTH_SECRET`, `TOKEN_ENCRYPTION_KEY`, and Google OAuth client credentials.
2. On the Google Cloud OAuth client, add `{AUTH_URL}/api/auth/callback/google` (sign-in) and `{AUTH_URL}/api/gmail/callback` (inbox connect).
3. Start PostgreSQL: `docker compose up -d`
4. Install and migrate:

```bash
npm install
npx prisma migrate deploy
npm run db:seed
npm test
npm run dev
```

Optional worker (renewal reminders, inactivity scan, snapshot purge, periodic Gmail sync):

```bash
npm run worker
```

## Phase 3 decisions

- **Pending review workflow**: low-confidence items become `PENDING_REVIEW` subscriptions. Users confirm or dismiss them from `/reviews` (`POST /api/reviews/:id/confirm|dismiss`). Confirm may include edits. Dismiss is terminal (`DISMISSED`).
- **Mixed-currency reporting**: spend totals are grouped by ISO 4217 code and never summed across currencies. The dashboard and `GET /api/reports/spend` return `MIXED_CURRENCY_NO_FX` when more than one currency is present.
- **Email snapshots**: truncated source text is stored with `expiresAt` (default 30 days) and purged by the worker. Full-account deletion cascades via Prisma.
- **Gmail/LLM**: Gmail OAuth is read-only (`gmail.readonly`) with PKCE, HMAC-signed state, AES-GCM refresh-token storage, incremental history sync, and exponential backoff on 429s.

## Phase 5 decisions

- **Extraction contract**: the LLM returns `is_subscription`, `is_cancellation`, vendor, price, billing cycle, renewal date, and confidence as strict JSON; a malformed response gets one repair retry before failing safe into `PENDING_REVIEW`.
- **Confidence is never trusted raw**: known-billing-domain and exact-vendor-match signals boost it; invalid currency, missing/invalid price, implausible renewal date, or unknown billing cycle cap it below the auto-apply threshold (skipped for cancellations, which legitimately omit those fields).
- **Vendor safety net**: exact alias match is trusted; a fuzzy match (Dice coefficient ≥ 0.88) is never auto-applied, always routed to review, so near-miss vendor names are never silently merged.
- **Cancellation handling**: a detected cancellation auto-cancels the matching `ACTIVE` subscription only when confidence clears the auto-apply threshold and the vendor match is exact; otherwise the existing subscription is flagged `PENDING_REVIEW` (`possible_cancellation_low_confidence`) rather than silently left `ACTIVE` or duplicated.
- **Known gaps** (see [docs/phase5-extraction-validation.md](docs/phase5-extraction-validation.md)): confirmed vendor reviews don't yet feed back into the alias table. The prefilter keyword list was widened once Phase 7 adversarial testing surfaced a real gap (`"trial ends"` → `"trial"`) — see [docs/phase7-data-quality-validation.md](docs/phase7-data-quality-validation.md).

## Phase 6 decisions

- **Writes are transactional**: create, update, and cancel persist the subscription row, append-only events, optional price-change row, and audit log in one `prisma.$transaction`.
- **History is queryable**: each subscription exposes event history and price-change history; users can add and edit subscriptions manually, and those edits emit `CREATED`, `UPDATED`, `RENEWED`, `PRICE_CHANGED`, or `CANCELED`.
- **Renewals and audit have first-class reads**: upcoming renewals are queried by `nextRenewalDate` window, and the audit log is listed per user.
- **Database review, all findings fixed** (see [docs/phase6-database-review.md](docs/phase6-database-review.md)): the Gmail-driven pipeline's writes (and `ReviewService.confirm`/`dismiss`, found while fixing this) now go through the same transactional `applyWrite` helper as the manual CRUD path, so a mid-sequence crash can no longer silently lose event/price-change history. `AlertJobs` issues one batched query across all connected users instead of one per user. `NotificationRepository.createIfAbsent` now rethrows anything that isn't a genuine duplicate. `AuditLog` gets a configurable retention purge (`AUDIT_LOG_RETENTION_DAYS`, default 180) — `SubscriptionEvent`/`PriceChange` are kept forever by design. `listByUser` accepts a status set so spend reporting queries only what it needs. History reads (`listEvents`/`listPriceChanges`) are `userId`-scoped at the query level, not just by caller convention.

## Phase 7 decisions

- **Unit coverage target is scoped**: `npm run test:coverage` measures application, domain, shared, and Gmail parse/retry helpers (not Next.js routes, Prisma, or the Google SDK client) and currently reports 96% lines / 93% functions, failing the build under 90%.
- **Integration tests drive the real sync → pipeline → alert path** against in-memory repositories and a fake inbox, using the same fixtures as extraction.
- **End-to-end scenarios** cover new subscription, renewal, cancellation, trial upgrade, price increase, duplicate receipt, a receipt lookalike, and Gmail auth failure.
- **Adversarial testing + data-quality validation, both fixed** (see [docs/phase7-data-quality-validation.md](docs/phase7-data-quality-validation.md)): 100 hand-annotated adversarial emails across ambiguous invoices, trial subscriptions, international currencies, mixed languages, changed pricing models, and partial renewal notices, run through the real pipeline. Found and fixed a high-severity bug (a monthly→annual price change updated the price but silently left the old `billingCycle` on the record forever) and a medium-severity one (the prefilter's `"trial ends"` keyword missed most real trial-lifecycle phrasing, silently dropping those emails before the LLM ever saw them — widened to `"trial"`). All 100 cases pass after the fixes.

## Phase 8 decisions

- **Security review + prompt injection testing, High/Medium findings fixed** (see [docs/phase8-security-review.md](docs/phase8-security-review.md) and [docs/phase8-prompt-injection-testing.md](docs/phase8-prompt-injection-testing.md)): found and closed the concrete version of "prompt injection risk" for this product — cancellation auto-apply trusted vendor name and confidence alone with no sender check, so a spoofed or lookalike-domain email claiming to be a real vendor's cancellation notice could silently stop tracking a real, paid subscription. Auto-cancel now also requires the sender to be on the known-billing-domain allowlist (`isKnownBillingSender`); renewal/price-change auto-apply is deliberately left ungated (lower-consequence, self-correcting, and gating it would push most legitimate lesser-known vendors into permanent manual review) — tracked as a documented residual risk with a recommended future fix (per-subscription learned sender trust, not a bigger global allowlist).
- **Also fixed**: the catch-all API error logger printed the raw error object, which for Gmail API failures (Gaxios-style errors) risked writing OAuth tokens into server logs — now logs only the message. The token encryptor silently fell back to reusing the session-signing secret when `TOKEN_ENCRYPTION_KEY` was unset — that fallback is removed, so a missing key now fails clearly instead of silently weakening credential separation.
- **Reviewed, no issues found**: OAuth (PKCE, signed/expiring/user-bound state, cookie flags), credential storage (bcrypt, AES-256-GCM), data retention, and the rendering layer (no `dangerouslySetInnerHTML`/`eval` anywhere, so a malicious vendor name can't become executing script or markup).

## Phase 9 decisions

- **Engineering review, no critical/major issues found** (see [docs/phase9-engineering-review.md](docs/phase9-engineering-review.md)): an independent pass beyond Phases 5/6/8's narrower lenses found and fixed three minor issues — a dead unreachable branch in `matchSubscription` (now an explicit assertion instead of a silent guess), a currency-conversion helper (`minorToMajorUnits`) that existed but was unused while two call sites duplicated the same math incorrectly for non-2-decimal currencies (closes [Phase 5 finding V4](docs/phase5-extraction-validation.md)), and two untested defensive error branches. Current coverage: 97.78% lines, 88.59% branches, 93.47% functions, 228 tests.

## Phase 10 decisions

- **Scalability review (10,000-user assumption), two code-fixable blockers fixed** (see [docs/phase10-scalability-review.md](docs/phase10-scalability-review.md)): the Postgres advisory lock's acquire/release could run on different pooled connections, making the unlock a silent no-op and leaking the lock until that connection cycled — silently disabling Gmail sync for that user. Live-verified against a real Postgres instance under concurrent load: the old implementation failed to reacquire the lock 49/50 times; the fix (pinning both calls to one connection via `prisma.$transaction`) failed 0/50. The Gmail-sync worker loop was fully serial across users (~2.8 hours for 10k users at 1s/user, far longer than its own 15-minute schedule) — now runs with configurable bounded concurrency (`GMAIL_SYNC_CONCURRENCY`, default 10) via a new `runWithConcurrency` helper. Scheduled jobs also gained an overlap guard (skip a tick if the previous run is still in progress).
- **Not code-fixable**: a single Google Cloud project's Gmail API quota is shared across every user — back-of-envelope, 10k users on a 15-minute poll is ~960k API calls/day minimum, plausibly enough to hit quota well before 10k users. Needs a quota increase, sharding across projects, or a move to Gmail push notifications (`users.watch`) — an infrastructure/ops decision, not a code change.
- **Documented, not fixed**: the worker is a single process with no distributed-scheduling story if ever run as multiple replicas (the per-user Gmail sync lock already handles that case; the alert/purge jobs don't yet). Not needed at one replica, flagged as a known ceiling rather than a surprise.

## Phase 11 decisions

- **Pre-release audit: Conditional Go** (see [docs/phase11-pre-release-audit.md](docs/phase11-pre-release-audit.md)): synthesizes Phases 1–10 and adds independent coverage of monitoring, alerting, and disaster recovery — none of which exist yet in this repo (no APM/error tracking, no operational alerting, no documented backup/restore procedure) and all three are correctly infrastructure/vendor decisions this review can flag but not make. This phase also found and fixed its own High-severity gap: **no user-facing account deletion existed at all** — the database cascade was correct (verified in Phase 6) but nothing could trigger it, leaving GDPR Article 17 (right to erasure) with no working path. Added `UserRepository.deleteAccount`, a `DELETE /api/account` route, and a confirm-then-delete Settings UI that signs the user out on success — **live-verified**: registered a real account against an isolated Postgres instance, deleted it through the actual UI, and confirmed a subsequent login with the same credentials correctly fails.
- **Remaining launch items are all decisions, not defects**: choose monitoring/alerting tooling, document and test a backup/restore procedure, decide the Gmail API quota strategy (Phase 10, L4), and get a legal review of privacy/terms language (a first engineering draft now exists at [docs/privacy-policy.md](docs/privacy-policy.md)). Every code-fixable blocker found across all eleven phases has been fixed.

## Post-Phase-11 operational decisions

Working through the four remaining Phase 11 launch items in order, as decisions get made (no production environment exists yet — this is building the pieces so they're ready the moment one does):

- **Backups: decided.** Self-managed Postgres, daily `pg_dump --format=custom` shipped to S3-compatible object storage, 24-hour RPO. `scripts/backup-db.sh` / `scripts/restore-db.sh`, documented in [docs/backup-and-disaster-recovery.md](docs/backup-and-disaster-recovery.md) (setup, cron schedule, and how to actually test a restore rather than just trust one).
- **Monitoring/alerting: decided (Sentry), integration in progress** — being installed outside this session; not yet wired into the error paths here to avoid colliding with that work.
- **Gmail API quota strategy: not yet decided.**
- **Legal/privacy review: draft exists** ([docs/privacy-policy.md](docs/privacy-policy.md)), engineering-authored and code-accurate, explicitly not published until a qualified legal reviewer signs off.

## Development Roadmap

1. [x] Define requirements and system architecture.
2. [x] Design the data model and processing workflows.
3. [x] Scaffold the application and infrastructure.
4. [x] Implement secure Gmail synchronization.
5. [x] Build and validate the subscription extraction pipeline.
6. [x] Add persistence, history, renewals, and audit logging.
7. [x] Create unit, integration, end-to-end, and adversarial tests.
8. [x] Complete security, engineering, scalability, and release reviews.

## Development Playbook

See [subscription-tracking-agent-prompts.md](subscription-tracking-agent-prompts.md) for the prompts and review stages used throughout the planned development lifecycle.

## Design Docs

- [docs/architecture.md](docs/architecture.md) — Phase 1 output: initial architecture design and architecture review.
- [docs/technical-design.md](docs/technical-design.md) — Phase 2 output: database schema, Gmail workflow, extraction pipeline, lifecycle state machine, and alert scheduling.
- [docs/phase5-extraction-design.md](docs/phase5-extraction-design.md) — Phase 5 output: extraction prompt/schema, validation rules, vendor/matching strategy, cancellation handling.
- [docs/phase5-extraction-validation.md](docs/phase5-extraction-validation.md) — Phase 5 output: QA review of vendor accuracy, false positive/negative risk, international billing, currency conversion, and lifecycle edge cases, with severity/confidence ratings.
- [docs/phase6-database-review.md](docs/phase6-database-review.md) — Phase 6 output: database review covering normalization, scalability, query performance, historical tracking, data retention, and auditing, with severity/confidence ratings and recommended schema improvements.
- [docs/phase7-data-quality-validation.md](docs/phase7-data-quality-validation.md) — Phase 7 output: 100-example adversarial email set and data-quality review of the pipeline's handling of each, with findings, fixes, and category-by-category results.
- [docs/phase8-security-review.md](docs/phase8-security-review.md) — Phase 8 output: risk matrix covering OAuth, stored credentials, prompt injection, sensitive data exposure, logging, and retention, with severity ratings.
- [docs/phase8-prompt-injection-testing.md](docs/phase8-prompt-injection-testing.md) — Phase 8 output: malicious-email examples (prompt injections, jailbreaks, hidden instructions, HTML-based and embedded-content attacks) and the defense each one exercises.
- [docs/phase9-engineering-review.md](docs/phase9-engineering-review.md) — Phase 9 output: principal-engineer review (critical/major/minor issues, refactoring suggestions, test coverage, architecture alignment, release recommendation).
- [docs/phase10-scalability-review.md](docs/phase10-scalability-review.md) — Phase 10 output: scalability review at a 10,000-user assumption, covering architecture, reliability, scaling strategy, database load, Gmail API quotas, cost model, and background processing, with launch blockers and fixes/recommendations.
- [docs/phase11-pre-release-audit.md](docs/phase11-pre-release-audit.md) — Phase 11 output: CTO-level pre-release audit synthesizing all prior phases plus new coverage of monitoring, alerting, disaster recovery, and compliance, with a Go/No-Go recommendation and the full cross-phase launch-blocker list.
- [docs/privacy-policy.md](docs/privacy-policy.md) — engineering-authored first draft of a user-facing privacy policy, written from the actual schema/config/LLM-integration to close the gap Phase 11 flagged ("Get a legal/privacy review of user-facing policy language"). Contains `[TODO]` placeholders for legal entity, hosting provider, and contact details, and needs an actual legal review before publishing.

## Security and Privacy

The implementation requests `gmail.readonly` only, encrypts refresh tokens at rest under a dedicated key (no session-secret fallback), scopes all queries by `user_id`, treats email bodies as untrusted LLM data with no tool/action capability given to the model, and keeps raw snapshots and audit logs on a TTL. State-changing actions against an *existing* subscription (cancellation) require both model confidence and a verified sender domain — see [docs/phase8-security-review.md](docs/phase8-security-review.md) for the full risk matrix.
