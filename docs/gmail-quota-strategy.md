# Gmail API Quota Strategy

*Resolves the remaining open item from [Phase 10 — Scalability Review](phase10-scalability-review.md), L4: a single Google Cloud project's Gmail API quota is shared across every user, and 10,000 users on a 15-minute poll is a baseline of ~960k API calls/day — plausibly enough to hit quota before reaching that scale.*

## Decision

**Near-term: request a quota increase.** **Long-term: migrate from polling to Gmail push notifications** (`users.watch` + Google Cloud Pub/Sub) before onboarding meaningfully toward 10,000 users. Sharding across multiple Google Cloud projects (the third option considered) is rejected — it multiplies quota linearly but adds real operational complexity (multiple OAuth consent screens, multiple credential sets to manage and rotate) without fixing the underlying inefficiency of polling every connected user on a fixed interval regardless of whether anything changed.

## Why this split, not just "do the big fix now"

Push notifications are the architecturally correct answer — they cut the polling baseline from "check every user every 15 minutes" to "get told exactly when a specific user's inbox actually changes," which is a different order of magnitude, not just a bigger number. But **this repo has zero production traffic right now** ([Phase 11](phase11-pre-release-audit.md) — no production environment exists yet), and push notifications require infrastructure this session can't provision (a Google Cloud Pub/Sub topic, IAM bindings granting the Gmail API publish rights to it) and a real architectural shift (a webhook endpoint, watch-renewal scheduling, a fallback poll for missed notifications). Building that now, against assumptions about usage patterns that don't exist yet, is exactly the kind of premature complexity worth avoiding — the design below is written so it's ready to implement once there's a concrete reason to (real user growth approaching the quota ceiling), not built speculatively today.

A quota increase request, by contrast, is cheap, reversible, and doesn't commit the architecture to anything — it's the right thing to do early regardless of which long-term path gets built, so it's listed as the immediate action.

## Near-term: request a quota increase

**Action item, not something this session can execute** — it requires access to the Google Cloud Console for whichever project ends up hosting this in production (which doesn't exist yet either). Having an existing paid Google account (mentioned in this conversation) doesn't by itself raise *Gmail API* quota — that's a separate, per-GCP-project limit from any Google Workspace/Google One subscription — but it does mean there's likely already billing/support access on a Google account that can be used to create the GCP project and file the quota request through a paid support channel rather than starting cold, which can matter for how quickly Google responds. When that project exists:
1. In Google Cloud Console → APIs & Services → Gmail API → Quotas, request an increase on the relevant per-user and per-project limits.
2. Include a justification: read-only, `gmail.readonly`-scoped subscription-tracking use case, current/projected user count, and the polling interval (`GMAIL_LOOKBACK_MONTHS`/sync cadence already configurable via `appConfig`).
3. Google's review timelines vary — request this well before it's actually the bottleneck, not when quota errors start appearing in production.

## Long-term: migrate to Gmail push notifications

Scoped design, not implemented:

- **Setup (one-time, per production GCP project):** create a Pub/Sub topic, grant `gmail-api-push@system.gserviceaccount.com` publish rights to it (Google's documented requirement for Gmail push), and create a push subscription pointing at a new webhook route in this app.
- **New endpoint:** `POST /api/gmail/push` — receives Pub/Sub's push payload (a base64-encoded `{ emailAddress, historyId }`), maps `emailAddress` back to a user, and triggers `GmailSyncService.syncUser` for just that user instead of iterating every connected user. This reuses the existing sync path entirely — `syncUser` already does incremental sync from a stored `historyId`, so push notifications just change *when* it's called, not *what* it does.
- **Watch registration:** call `users.watch()` for each connected user (on Gmail connect, and on renewal) to start push delivery. **Gmail watches expire after 7 days** — this needs a renewal job (a natural fit for the existing `node-cron` worker, similar in shape to the current sync cron but renewing watches instead of polling inboxes).
- **Fallback poll stays, at a much longer interval** (e.g., daily instead of every 15 minutes) as a safety net for missed/dropped push notifications — push delivery isn't guaranteed exactly-once, and this app's sync is already idempotent (`ProcessedEmail` ledger), so an occasional redundant poll is harmless.
- **Endpoint authentication:** Pub/Sub push requests can be configured to include an OIDC token Google signs; the webhook should verify that token rather than trusting the payload at face value — a webhook endpoint is a new unauthenticated-by-default surface and needs the same "don't trust the caller" discipline the rest of this app already applies to email content (see [Phase 8](phase8-security-review.md)).

## When to revisit

Before this becomes urgent: once there's a real production deployment and real connected-user growth, watch the actual Gmail API call volume against quota (via Cloud Console metrics, once that's monitored — see the monitoring/alerting work in progress) rather than reacting to a quota error in production. That's the trigger to move from "documented plan" to "build it."
