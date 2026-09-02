# Subscription Tracking Agent

AI-powered subscription tracker that scans Gmail invoices and receipts to automatically discover, monitor, and analyze recurring subscriptions.

## Project Status

Phase 4 Gmail integration is in place: read-only OAuth with PKCE and signed state, encrypted refresh tokens, incremental `historyId` sync, rate-limit retries, and metadata-first filtering so only relevant messages are fully fetched.

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
- **Gmail/LLM**: Gmail OAuth is read-only (`gmail.readonly`) with PKCE, HMAC-signed state, AES-GCM refresh-token storage, incremental history sync, and exponential backoff on 429s. Extraction calibration continues in Phase 5.

## Development Roadmap

1. [x] Define requirements and system architecture.
2. [x] Design the data model and processing workflows.
3. [x] Scaffold the application and infrastructure.
4. [x] Implement secure Gmail synchronization.
5. [ ] Build and validate the subscription extraction pipeline.
6. [ ] Add persistence, history, renewals, and audit logging.
7. [ ] Create unit, integration, end-to-end, and adversarial tests.
8. [ ] Complete security, engineering, scalability, and release reviews.

## Development Playbook

See [subscription-tracking-agent-prompts.md](subscription-tracking-agent-prompts.md) for the prompts and review stages used throughout the planned development lifecycle.

## Design Docs

- [docs/architecture.md](docs/architecture.md) — Phase 1 output: initial architecture design and architecture review.
- [docs/technical-design.md](docs/technical-design.md) — Phase 2 output: database schema, Gmail workflow, extraction pipeline, lifecycle state machine, and alert scheduling.

## Security and Privacy

The implementation requests `gmail.readonly` only, encrypts refresh tokens at rest, scopes all queries by `user_id`, treats email bodies as untrusted LLM data, and keeps raw snapshots on a TTL. A full retention/deletion policy is still required before the Phase 8 security review.
