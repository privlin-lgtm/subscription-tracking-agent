# Phase 5 — Subscription Detection Agent: Validation

*Phase 5 validation-phase output, per [subscription-tracking-agent-prompts.md](../subscription-tracking-agent-prompts.md). Reviews the design in [docs/phase5-extraction-design.md](phase5-extraction-design.md) against its actual implementation in [src/application](../src/application) and [src/infrastructure/llm](../src/infrastructure/llm), exercised by [subscription-pipeline.service.test.ts](../src/application/subscriptions/subscription-pipeline.service.test.ts).*

---

## Accuracy of Vendor Detection

The alias table ([prisma/seed.ts](../prisma/seed.ts)) currently seeds ~13 well-known vendors (Netflix, Spotify, Adobe, Microsoft 365, Google One, iCloud+, Amazon Prime/Music, GitHub, OpenAI). Exact-match lookups against this table are reliable; the Dice-coefficient fuzzy fallback (threshold 0.88) correctly refuses to merge distinct-but-similar names like "Amazon Prime" vs. "Amazon Music" (verified in [vendor-normalization.service.test.ts](../src/application/subscriptions/vendor-normalization.service.test.ts)) and routes near-miss typos like "Amazon Prime Vidoe" → "Amazon Prime Video" to review rather than auto-merging (new fixture-driven test added this pass).

**Finding V1 — Confirmed reviews don't feed back into the alias table.** `ReviewService.confirm` ([subscription.service.ts:74](../src/application/subscriptions/subscription.service.ts)) updates the subscription record but never writes an entry to `VendorAliasRepository`. A vendor outside the seed list that a user confirms this month will be re-extracted as an independent "unmatched" vendor next month if the raw sender text varies even slightly (different legal suffix, punctuation, casing beyond what `normalizeVendorKey` strips) — producing a second, un-deduplicated subscription rather than a renewal of the first.
- **Severity:** Medium
- **Confidence:** High (code-verified — no write path from `ReviewService` to `VendorAliasRepository` exists)
- **Recommendation:** on `confirm()`, upsert an alias row mapping the raw extraction's normalized key to the confirmed canonical name, so the system learns from every manual confirmation.

## False Positive Risks

The two-stage design (cheap prefilter → LLM classification with `is_subscription`) is the right shape: a prefilter false-positive only costs one LLM call, it doesn't create a subscription by itself. `calibrateConfidence` further caps confidence whenever price, currency, date, or billing cycle is missing/invalid, so a one-off invoice that superficially resembles a subscription email (matches "invoice" or "billed" in the prefilter) but lacks a real renewal cadence is very likely to land in `PENDING_REVIEW` rather than silently becoming a tracked subscription.

- **Residual risk:** a one-time purchase invoice that happens to include a plausible-looking recurring cadence in its body text (e.g. "next installment due in 30 days" on a payment plan, not a subscription) could clear all deterministic checks and auto-apply. This depends entirely on the LLM correctly setting `is_subscription: false` for such cases — there's no deterministic backstop for it.
- **Severity:** Low
- **Confidence:** Medium (plausible failure mode, not observed against real-world email samples — no adversarial email set has been run yet; that's Phase 7 in the playbook)

## False Negative Risks

> **Update:** Finding V2 below was resolved in this pass — see the note at the end of this section.

**Finding V2 — Cancellation emails are not recognized as a distinct signal, so canceled subscriptions never auto-transition out of `ACTIVE`.** The extraction schema ([extraction-schema.ts](../src/application/extraction/extraction-schema.ts)) has no field indicating "this email is a cancellation confirmation" — only `is_subscription`, price, and a renewal date. Tracing the pipeline: a cancellation email (e.g. "Your Netflix membership has been canceled") would pass the prefilter (matches the "membership" keyword) and likely reach the LLM with `is_subscription: true` but no renewal date — which caps confidence below the auto-apply threshold and routes it to `PENDING_REVIEW`. Even in the best case where a user confirms that review item, `ReviewService.confirm` only ever sets status back to `ACTIVE` ([subscription.service.ts:87](../src/application/subscriptions/subscription.service.ts)) — there is no path, automatic or manual-via-review, that transitions a subscription to `CANCELED` from an inbound email. Cancellation today is only reachable through the user manually clicking "Cancel" in the UI ([cancel-button.tsx](../src/app/(app)/subscriptions/[id]/cancel-button.tsx)), which is disconnected from Gmail entirely.
- **Impact:** a subscription the user canceled through the vendor will keep generating renewal reminders and stay counted in spend totals until the user separately remembers to cancel it in-app — directly undermining the "identify potentially unused subscriptions" and "track lifecycle" goals from the [Phase 1 architecture](architecture.md), and contradicting the Phase 2 technical-design state machine, which specifies `ACTIVE → CANCELED` on "cancellation email detected."
- **Severity:** High
- **Confidence:** High (code-verified: grepped the full `src/` tree for `CANCELED`/`cancel` — the only write of `SubscriptionStatus.CANCELED` is in the manual `SubscriptionService.cancel()` path)
- **Recommendation:** extend the extraction schema with a signal field (e.g. `email_type: "new" | "renewal" | "price_change" | "cancellation" | "receipt" | "other"`), and add a `CANCELED` branch to `matchSubscription`'s decision set so a detected cancellation transitions an existing `ACTIVE` match to `CANCELED` (through review if confidence is anything less than very high, given the consequence of wrongly canceling a still-active subscription).
- **Resolved this pass:** the extraction schema now carries `is_cancellation` ([extraction-schema.ts](../src/application/extraction/extraction-schema.ts), [constants.ts](../src/shared/constants.ts)), the LLM prompt instructs the model to set it for cancellation/downgrade-to-free confirmations, and `SubscriptionPipelineService.handleCancellation` ([subscription-pipeline.service.ts](../src/application/subscriptions/subscription-pipeline.service.ts)) auto-cancels the matching `ACTIVE` subscription only when confidence clears the auto-apply threshold and the vendor match is exact; anything less certain flags the existing subscription as `PENDING_REVIEW` (`possible_cancellation_low_confidence`) with a notification, rather than auto-canceling or creating a disconnected duplicate row. A cancellation email with no matching active subscription is a no-op. Covered by three new fixture-driven tests in [subscription-pipeline.service.test.ts](../src/application/subscriptions/subscription-pipeline.service.test.ts).

**Finding V3 — Prefilter keyword list has gaps for common billing phrasing.** `SUBSCRIPTION_KEYWORDS` ([constants.ts](../src/shared/constants.ts)) covers "billed"/"billing"/"invoice"/"receipt"/"subscription"/"renewal"/etc., but common real-world phrasings like "charged", "payment received", "your statement", or "auto-pay" (without "auto-renew") are absent and would be dropped pre-LLM unless the sender happens to be on the small `KNOWN_BILLING_DOMAINS` list.
- **Severity:** Medium
- **Confidence:** Medium (judgment call on likely phrasing distribution — should be validated against the adversarial email set planned for Phase 7)
- **Recommendation:** treat the current keyword list as a starting point, not final; widen it based on Phase 7 adversarial testing results rather than guessing further now.

## Handling of International Billing

Both the prefilter keyword list and `KNOWN_BILLING_DOMAINS` are English/US-centric by design — this matches the Phase 1 architecture's explicit MVP scope decision ("Multi-language extraction beyond a small allowlisted set" is out of scope). A non-English billing email from a vendor not on the known-domains list will very likely never reach the LLM at all, which is a silent false negative rather than a `PENDING_REVIEW` — the user gets no signal that *anything* was missed.
- **Severity:** Medium (accepted MVP limitation, but the silence is worth flagging)
- **Confidence:** High (matches documented scope; the gap itself is a straightforward reading of the keyword list)
- **Recommendation:** no code change needed for MVP, but the roadmap item for multi-language support (Phase 1 roadmap item #2) should explicitly call out that today's gap is invisible to the user — worth a "we might have missed non-English subscriptions" note in-product rather than silence, when that work is scheduled.

## Currency Conversion Concerns

- Per-currency segregation (never summing across currencies, `MIXED_CURRENCY_NO_FX` in the spend endpoint per the current README) correctly resolves architecture-review finding #6 — **confirmed working as designed, no issue found.**
- Currency-mismatch-across-renewals is correctly never auto-merged (`matching.service.ts` → `currency_mismatch` → forced review) — **confirmed working as designed.**
- **Finding V4 (minor) — `ReviewService.confirm`'s implicit price recompute assumes 2-decimal currencies.** When a reviewer supplies a new `currency` without also supplying `priceAmount`, the code recomputes major-unit amount as `item.priceAmountCents / 100` ([subscription.service.ts:81](../src/application/subscriptions/subscription.service.ts)). That division is only correct for currencies with 100 minor units (most currencies); for JPY/KRW (minor-unit factor 1) or BHD/KWD (factor 1000) — both already special-cased in [money.ts](../src/domain/value-objects/money.ts) — this silently produces the wrong amount in the narrow case of a currency-only edit during review.
- **Severity:** Low
- **Confidence:** High (code-verified, narrow trigger condition: currency changed without amount also being resupplied)
- **Recommendation:** reuse `minorUnitsFor(item.priceCurrency)` instead of the hardcoded `/100` when back-converting existing cents to major units.

## Subscription Lifecycle Edge Cases

| Scenario | Current behavior | Assessment |
|---|---|---|
| First receipt for a new vendor | `no_match` → `ACTIVE` + `CREATED` | Correct |
| Same vendor/price, later date | `renewal` → update + `RENEWED` | Correct |
| Same vendor, different price | `price_change` → update + `PRICE_CHANGED` + `PriceChange` row + notification | Correct |
| Repeat receipt, same period | `duplicate` → no-op | Correct |
| Same vendor, different currency | `currency_mismatch` → forced review | Correct, never silently merged |
| Low-confidence / fuzzy vendor / invalid currency | `PENDING_REVIEW` | Correct, fail-safe |
| LLM call fails after repair retry | `PENDING_REVIEW` with `extraction_failed` | Correct, fail-safe (verified by new fixture test) |
| Cancellation email | No distinct handling — see **Finding V2** | **Gap** |
| Re-subscription after cancellation | Not yet reachable (depends on V2) but `matchSubscription` excludes `CANCELED`/`DISMISSED` candidates, so once V2 lands, a new receipt after cancellation will correctly be treated as `no_match` → a fresh `ACTIVE` record rather than reactivating the old one, consistent with the Phase 2 technical design's decision to model this as a new lifecycle | Correct once V2 lands |
| Inactivity (no renewal signal for N cycles) | Not part of the extraction pipeline — handled separately by `AlertJobs` (Phase 6/background jobs), out of scope for this review | Not evaluated here |

---

## Summary and Recommendations

| # | Finding | Severity | Confidence |
|---|---|---|---|
| V2 | No cancellation-email detection; canceled subscriptions never auto-transition out of `ACTIVE` | **High** — *resolved this pass* | High |
| V1 | Confirmed vendor reviews don't feed back into the alias table, causing recurring dedup misses | Medium | High |
| V3 | Prefilter keyword list has real gaps ("charged", "payment received", etc.) | Medium | Medium |
| International billing | Non-English mail from unknown senders is silently dropped, no user-visible signal | Medium | High |
| V4 | Review-time currency edit mis-converts cents for non-2-decimal currencies | Low | High |
| One-time-invoice false positive | Depends entirely on LLM judgment, no deterministic backstop | Low | Medium |

**Recommendation before Phase 6 (persistence/history hardening) or Phase 7 (adversarial testing):** V2 — the one gap that contradicted an explicitly documented design decision (the Phase 2 state machine) rather than being an accepted MVP tradeoff — is resolved. V1 and V3 are reasonable to defer to be informed by Phase 7's adversarial email set rather than fixed speculatively now.
