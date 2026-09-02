# Phase 8 — Security Review

*Phase 8 "Security Review" output (tool: Claude), per [subscription-tracking-agent-prompts.md](../subscription-tracking-agent-prompts.md). Evaluates the implemented system — OAuth, credential storage, prompt injection exposure, sensitive data handling, logging, and retention — against the actual code, not the design intent alone.*

> Companion doc: [docs/phase8-prompt-injection-testing.md](phase8-prompt-injection-testing.md) covers the "Prompt Injection Testing" half of this phase — concrete malicious-email examples and the defense each one exercises.

---

## Risk Matrix

| # | Finding | Area | Severity | Status |
|---|---|---|---|---|
| S1 | Cancellation auto-apply trusted vendor name + confidence alone — no sender verification | Prompt injection / OAuth-adjacent trust boundary | **High** | **Fixed** |
| S2 | API error handler logged the raw error object, risking OAuth tokens leaking into server logs | Logging practices / sensitive data exposure | **High** | **Fixed** |
| S3 | Token-encryption key silently fell back to reusing the session-signing secret when unset | Stored credentials | Medium | **Fixed** |
| S5 | Renewal/price-change auto-apply against an existing subscription still has no sender check | Prompt injection (residual, scoped down) | Low | Accepted, documented |
| S4 | AES-256-GCM key derivation uses a static (non-random) salt | Stored credentials | Low | Accepted, documented |
| S6 | OAuth implementation (PKCE, signed/expiring/user-bound state, cookie flags) | OAuth implementation | Info | Reviewed, no issue |
| S7 | Credential storage (bcrypt passwords, AES-256-GCM refresh tokens) | Stored credentials | Info | Reviewed, no issue |
| S8 | Data retention (snapshot TTL, audit TTL, permanent event/price history by design) | Data retention | Info | Reviewed, no issue |
| S9 | API error response bodies (DomainError/ZodError messages) | Sensitive data exposure | Low | Reviewed, low residual risk |

---

## S1 — Cancellation auto-apply trusted vendor name and confidence alone, with no sender verification

**The finding:** `SubscriptionPipelineService.handleCancellation`'s `confidentCancellation` gate was `calibrated.confidence >= threshold && vendor.kind !== "fuzzy"` — nothing checked *who sent the email*. An attacker doesn't need a working prompt injection to exploit this: any email that convinces the extraction step (a real model, or a hypothetical compromised/buggy one) that `is_cancellation: true, vendor: "Netflix", confidence: 0.9` is enough, from **any sender**, including a spoofed or lookalike domain (`netfIix-billing.example`, capital I for lowercase l). `calibrateConfidence`'s sender-domain check only ever *adds* a confidence boost for known domains — it never requires one. Since cancellation skips the price/date/currency quality checks entirely (they're expected to be absent), there was no other guard standing between a convincing fake and a real, paid subscription's tracking silently flipping to `CANCELED`.

- **Impact:** the user stops getting renewal reminders and stops being tracked for a subscription they're still actually paying for — the exact opposite of the product's core promise, triggered by a single inbox message the user never even has to open.
- **Severity:** High (silent, no user action required, undermines the core value proposition, and the attack email itself doesn't need to be sophisticated — a spoofed sender plus plausible cancellation wording may be enough even without a genuine prompt-injection technique)
- **Confidence:** High (code-verified: reproduced with a dedicated fixture — see [S1 in the companion doc](phase8-prompt-injection-testing.md#attack-6--sender-spoofing-with-no-injection-at-all))
- **Fix:** `confidentCancellation` now also requires `isKnownBillingSender(message.sender)` — a new shared helper (`shared/constants.ts`) extracted from the existing domain-boost logic. Anything failing that check still gets the existing safe fallback: the record is flagged `PENDING_REVIEW` rather than either silently canceled or silently ignored. New regression test in `subscription-pipeline.service.test.ts` confirms a high-confidence, exact-vendor-match cancellation from an unlisted sender is held for review, not applied.

## S5 — Renewal/price-change auto-apply is deliberately *not* gated the same way (residual risk, accepted)

The same reasoning applies in principle to `renewal`/`price_change` auto-apply against an existing subscription — a fake "price increased" email could corrupt the tracked price without a real vendor sending it. This was evaluated and **deliberately not fixed the same way**: gating on `KNOWN_BILLING_DOMAINS` (11 hardcoded majors) for every renewal/price-change would route the *majority* of real-world vendors — anyone not in that short list — to permanent manual review for their entire subscription lifetime, defeating the product's purpose for most vendors. Cancellation is asymmetric: a false cancellation silently *stops* tracking (the failure is invisible until the user is surprised by a real charge), while a false price change is visible on every dashboard view and self-corrects on the next genuine receipt — a materially lower-consequence failure mode, so it was judged not worth the usability cost of the same fix.

- **Severity:** Low (self-correcting, visible, no loss of service tracking)
- **Recommendation for a future pass:** replace the global-allowlist approach entirely with a **per-subscription learned sender** — store the sender domain of the email that *originally created* each subscription, and require renewal/price-change/cancellation mail to match either that stored domain or the global allowlist. This is strictly more precise than a hardcoded list (it doesn't penalize legitimate lesser-known vendors after their first receipt) but needs a schema migration (`Subscription.originSenderDomain`), so it's scoped out of this pass rather than done partially.

## S2 — API error handler logged the raw error object

**The finding:** `jsonError` (`infrastructure/http/api.ts`) fell through to `console.error(error)` for any error not already classified as a `DomainError` or `ZodError`. The `/api/gmail/sync` route (and anywhere else Gmail API calls surface an unclassified failure) can throw errors from `googleapis`/`google-auth-library` (Gaxios-style), which routinely attach the **full outgoing HTTP request** — including `Authorization` headers carrying OAuth access tokens, and potentially refresh-token-bearing request bodies during a token refresh — to `error.config`/`error.response`. Logging the raw error object risks writing live Gmail credentials into server logs, which are typically retained longer, shipped to more systems, and accessible to more people than the database itself.
- **Severity:** High (credential exposure into a lower-trust, longer-retention system; triggerable by an ordinary transient Gmail API failure, not just an attack)
- **Confidence:** High (code-verified path from an unclassified Gmail-call failure to this line; Gaxios's request-config-on-error behavior is well-documented upstream, not this codebase's own bug, but this codebase's logging call was the exposure point)
- **Fix:** `jsonError` now logs only `error.message` (mirroring the pattern already correctly used in `worker.ts`), never the raw error object.

## S3 — Token-encryption key silently fell back to the session-signing secret

**The finding:** `composition.ts` constructed the token encryptor as `new AesGcmTokenEncryptor(appConfig.tokenEncryptionKey || appConfig.authSecret)`. If `TOKEN_ENCRYPTION_KEY` was ever left unset — a plausible misconfiguration, since `.env.example` ships it as an empty string — Gmail refresh tokens would be encrypted under `AUTH_SECRET`, the same secret that signs session JWTs. This violates key separation (a compromise of one secret compromises both) and creates a silent footgun: rotating `AUTH_SECRET` for an unrelated reason (e.g. a session-related incident response) would simultaneously and silently break decryption of every stored Gmail refresh token, with no warning at deploy time.
- **Severity:** Medium (misconfiguration-dependent, not a live exploit path today, but README already documents `TOKEN_ENCRYPTION_KEY` as required — the code just didn't enforce it)
- **Fix:** removed the fallback. `AesGcmTokenEncryptor` already throws a clear `ValidationError` on first use if given an empty/too-short secret — now that's exactly what happens if `TOKEN_ENCRYPTION_KEY` is missing, instead of a silent security downgrade.

## S4 — Static salt in key derivation (accepted)

`AesGcmTokenEncryptor.key()` derives the AES key via `scryptSync(secret, "subscription-tracker-tokens", 32)` — a hardcoded, non-random salt. A static salt matters most when defending a *low-entropy, guessable* input (e.g. a user password) against precomputed rainbow-table attacks; here the input is `TOKEN_ENCRYPTION_KEY`, expected to be a properly generated high-entropy secret (`.env.example` suggests a 32-byte hex value), for which a static salt adds negligible practical risk. Not fixed — a per-install random salt would need to be generated once and persisted (a new config value or DB row), adding real operational complexity for a risk reduction that's marginal given the expected secret entropy. Documented as an accepted tradeoff rather than silently left unexamined.

## S6 — OAuth implementation: reviewed, no issues found

- **PKCE**: `generatePkce()` uses a 32-byte random verifier and SHA-256 challenge, correctly wired through `connect` → cookie → `callback` → `exchangeGmailCode`.
- **State**: `signOAuthState`/`verifyOAuthState` use HMAC-SHA256 with `timingSafeEqual` for signature comparison, bind the state to the signed-in `userId`, and expire after 10 minutes — CSRF and cross-user-state-injection are both closed.
- **Cookie**: the PKCE verifier cookie is `httpOnly`, `sameSite: "lax"`, `secure` when `AUTH_URL` is HTTPS, scoped to `/api/gmail`, 10-minute `maxAge`, and explicitly cleared on both the success and failure paths of the callback.
- **Scope**: `gmail.readonly` only, matching the architecture's stated minimalism (verified against `gmail.client.ts`'s scope constant, not just the docs).

## S7 — Credential storage: reviewed, no issues found

- Passwords: bcrypt via `bcryptjs`, standard `compare` usage, no plaintext password ever persisted or logged.
- Gmail refresh tokens: AES-256-GCM, random 12-byte IV per encryption, auth tag verified on decrypt, versioned ciphertext format (`v1:iv:tag:data`) — and now (post-S3) always under a dedicated key, never a reused session secret.

## S8 — Data retention: reviewed, no issues found

Consistent with the Phase 6 decisions: `EmailSnapshot` TTL + purge (raw email content), `AuditLog` TTL + purge (added in Phase 6), and `SubscriptionEvent`/`PriceChange` retained permanently by explicit product decision (the user-facing historical record, not a diagnostic trail). No new gap found; this phase's job was to confirm the retention story is actually implemented, not just documented, and it is.

## S9 — API error response bodies: low residual risk

`DomainError` messages are developer-authored strings (e.g. `"Subscription not found"`), safe to return. `ZodError` responses return `error.issues[0]?.message`, which is normally a schema-shape description ("Expected string, received number") rather than the offending value — low risk, but zod issue messages can occasionally embed a literal value for certain refinement failures, so this is noted as a small residual exposure rather than a confirmed zero-risk path. Not treated as actionable on its own: no route in this codebase currently validates anything sensitive enough (passwords, tokens) through a zod schema that reaches this response path.

---

## Summary

Two High-severity, code-verified issues (S1, S2) and one Medium (S3) are fixed in this pass. S1 is the most product-relevant: it's the concrete version of the "prompt injection risk" the phase asks about — not a jailbreak in the AI-safety sense, just a missing sender-authentication check on the single highest-consequence auto-applied action. S2 closes a credential-into-logs path that had nothing to do with attackers at all — it could fire on an ordinary Gmail API hiccup. S5 and S4 are documented, reasoned decisions to *not* fix further right now, with a specific recommendation each, rather than silent gaps.
