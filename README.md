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

## Development Roadmap

1. [x] Define requirements and system architecture.
2. [x] Design the data model and processing workflows.
3. [x] Scaffold the application and infrastructure.
4. [x] Implement secure Gmail synchronization.
5. [x] Build and validate the subscription extraction pipeline.
6. [x] Add persistence, history, renewals, and audit logging.
7. [x] Create unit, integration, end-to-end, and adversarial tests.
8. [ ] Complete security, engineering, scalability, and release reviews.

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

## Security and Privacy

The implementation requests `gmail.readonly` only, encrypts refresh tokens at rest under a dedicated key (no session-secret fallback), scopes all queries by `user_id`, treats email bodies as untrusted LLM data with no tool/action capability given to the model, and keeps raw snapshots and audit logs on a TTL. State-changing actions against an *existing* subscription (cancellation) require both model confidence and a verified sender domain — see [docs/phase8-security-review.md](docs/phase8-security-review.md) for the full risk matrix.
