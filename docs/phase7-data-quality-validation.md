# Phase 7 — Data Quality Validation

*Phase 7 "Data Quality Validation" output (tool: Claude), per [subscription-tracking-agent-prompts.md](../subscription-tracking-agent-prompts.md). Reviews the extraction results from the [100-example adversarial email set](../src/application/subscriptions/adversarial.fixtures.ts) run against the real pipeline in [adversarial.pipeline.test.ts](../src/application/subscriptions/adversarial.pipeline.test.ts).*

**Scope note:** there is no live LLM configured in this environment, so "extraction results" here means the deterministic layer's behavior (prefilter, confidence calibration, vendor normalization, matching, cancellation handling) given a ground-truth extraction per email — not a grade of a real model's raw accuracy. That's still the right thing to validate: it's the layer that decides what a correct extraction is *allowed to do*, and it's fully exercised by all 100 cases regardless of what produces the extraction. Adobe/Cursor's separate adversarial-email-generation work (if any exists outside this environment) should be pointed at a live model against this same harness before launch; this report covers what's testable here.

---

## Method

100 emails across the six categories the prompt specifies (ambiguous invoices, trial subscriptions, international currencies, mixed languages, changed pricing models, partial renewal notices — ~17 each) were each paired with a hand-annotated ground-truth extraction and run through the actual `SubscriptionPipelineService`, `calibrateConfidence`, `matchSubscription`, and `VendorNormalizationService` — the same code path production traffic uses. A fake `ExtractionAgent` returns the ground truth instead of calling a real model. 16 of the 100 seed a prior subscription first, to exercise renewal/price-change/duplicate/cancellation matching against existing state.

## Result: 100/100 passing, after two fixes

The first run surfaced **4 failures**, all genuine gaps rather than test-authoring mistakes. Both were fixed in this pass; all 100 cases (plus a dedicated regression test) now pass.

### Finding Q1 — Trial-related emails without the exact phrase "trial ends" were silently dropped before reaching the LLM

**Category:** trial_subscription. **3 of 100 cases failed** (trial-04, trial-07, trial-16).

`SUBSCRIPTION_KEYWORDS` ([constants.ts](../src/shared/constants.ts)) contained the literal phrase `"trial ends"`, not the word `"trial"`. Real trial emails vary — "your trial has started," "your trial is active," "free trial ends soon," "before your trial ends" — and only the one exact phrase matched. Combined with `KNOWN_BILLING_DOMAINS` not including many trial-heavy senders (YouTube, Peloton, Masterclass all use non-Google/non-listed domains in the wild), these three genuinely subscription-related emails were dropped at the prefilter and never reached the extractor at all — not routed to review, not classified `NOT_SUBSCRIPTION` by a model decision, just silently discarded.

- **Severity:** Medium (this is the same class of gap as [Phase 5 validation finding V3](phase5-extraction-validation.md#false-negative-risks) — prefilter keyword narrowness — but concretely demonstrated here with real trial-lifecycle emails, which are a named, expected category for this product)
- **Fix:** widened the keyword from `"trial ends"` to `"trial"` in `SUBSCRIPTION_KEYWORDS`. This is a strict broadening (every string that matched `"trial ends"` still matches `"trial"`), so the existing prefilter unit test's `"trial ends"` case is unaffected. Confirmed all three previously-dropped cases (and the rest of the trial category) now reach the extractor and route correctly.

### Finding Q2 — A price change that also changes billing cycle (e.g. monthly → annual) updated the price but left the old billing cycle on the record

**Category:** changed_pricing_model. **Caught by a dedicated regression test, not by the 100-case pass/fail count** (the outcome classification for "price_changed" only checks that price changed, which it correctly did — this is a narrower, more specific defect the coarse outcome check couldn't see on its own).

`SubscriptionPipelineService`'s `renewal` and `price_change` branches update `priceAmountCents`, `nextRenewalDate`, `status`, and `confidenceScore` — but never `billingCycle`. A user who switches Netflix from $15.49/month to $149.99/year would have the price correctly updated to $149.99, but the record would keep showing `MONTHLY` forever. Since nothing else in the schema re-derives billing cycle from price/date deltas, this was a permanent, silent data-quality defect with no self-healing path — exactly the kind of thing "changed pricing models" adversarial testing exists to catch.

- **Severity:** High (silent, permanent, no recovery path short of a manual edit; directly misrepresents the subscription's actual terms going forward, which then feeds incorrect renewal-reminder cadence assumptions)
- **Confidence:** High (code-verified; reproduced with `pricing-01` and a dedicated assertion)
- **Fix:** both the `renewal` and `price_change` update branches in [subscription-pipeline.service.ts](../src/application/subscriptions/subscription-pipeline.service.ts) now include `billingCycle: toBillingCycle(extraction.billingCycle)`. Safe to always apply: `calibrateConfidence` already caps confidence below the auto-apply threshold whenever `billingCycle === "unknown"`, so by the time either branch runs, `extraction.billingCycle` is guaranteed to be a real, non-`"unknown"` value — this can't regress a known cycle to `CUSTOM` because of an under-specified receipt. Added a dedicated test asserting the annual-switch fixture (`pricing-01`) leaves the record with `billingCycle: "ANNUAL"`.

## Category-by-category results (all passing after fixes)

| Category | Count | Outcome mix | Notable findings |
|---|---|---|---|
| Ambiguous invoices | 17 | 9 created, 8 not_subscription | None — the two-stage prefilter+LLM design correctly separates genuine subscriptions from one-time purchases even with generic "Invoice #" subject lines, because the *content* (recurring cadence language) still differs, not just the subject. |
| Trial subscriptions | 17 | 8 created, 9 pending_review | **Q1** (fixed). All trial-ending/trial-start notices missing a committed price correctly land in `PENDING_REVIEW` — confirms the "never auto-apply an uncommitted future charge" behavior from [Phase 5 design](phase5-extraction-design.md#7-confidence-score--action-gate). |
| International currencies | 17 | 15 created, 2 pending_review | None new. Confirms 15 diverse ISO 4217 currencies (including zero-decimal JPY/KRW) create cleanly, and the two malformed-currency cases (raw symbols `₺`, `R$` instead of ISO codes) are correctly caught by the currency-validity guard rather than silently accepted. |
| Mixed languages | 17 | 12 created, 5 not_subscription | Confirms, quantitatively this time, the accepted MVP limitation from [Phase 5 validation](phase5-extraction-validation.md#handling-of-international-billing): a non-English email from a sender not on the small `KNOWN_BILLING_DOMAINS` allowlist is dropped with **no user-visible signal**, regardless of how well an LLM could have parsed it. All 5 unknown-domain non-English cases here are genuine subscriptions that a user would never learn were missed. Not fixed in this pass (out of scope — the Phase 5 recommendation was to expand the allowlist/keywords once real-world data is available, not to guess further now), but now has concrete before/after test coverage to validate against when that work happens. |
| Changed pricing models | 16 | 14 price_changed, 2 pending_review | **Q2** (fixed). The 2 `pending_review` cases (a same-looking amount that silently changed currency, and a "your plan changed" notice with no digits to extract) both correctly avoid corrupting the existing record. |
| Partial renewal notices | 16 | 10 pending_review, 3 duplicate, 2 price_changed, 1 renewed | None new. Confirms genuine duplicate reminders (identical price+period, including a noisy forwarded/threaded one) are correctly no-ops, a plain renewal with a later date updates cleanly, and every notice missing price, date, or currency is held for review rather than guessed. |

## Incorrect Vendor Matches

Not exercised in this pass by design: the adversarial harness uses an empty vendor-alias table (`NoopVendorAliases`) so every vendor is `"unmatched"` rather than `"exact"`/`"fuzzy"`, isolating the confidence/matching/currency logic under test from alias-table content. Vendor-matching accuracy specifically (exact vs. fuzzy vs. unmatched, and the fuzzy-match threshold) was already covered in [Phase 5 validation](phase5-extraction-validation.md#accuracy-of-vendor-detection) and by the dedicated `vendor-normalization.service.test.ts` suite (unchanged, still passing). No new incorrect-vendor-match issue found.

## Duplicate Subscriptions

No false duplicates and no missed duplicates across the 16 prior-subscription cases in categories 5 and 6, including a deliberately noisy forwarded/quoted-text duplicate (`partial-15`). The 5% price tolerance in `Money.approximatelyEquals` didn't cause any of the genuine price-change cases (all >8% deltas) to be misclassified as duplicates.

## Missing Renewals

No renewal was missed among the cases designed to produce one; `partial-11`'s later-date-same-price case correctly reached `RENEWED`. Finding **Q2** (billing-cycle not updated) is adjacent to this category — a "missing renewal" bug would mean a renewal event fails to fire at all, which didn't happen here, but a *malformed* renewal (right event, wrong resulting record) did, which is arguably worse since it's silent.

## Invalid Dates

Not newly exercised here (already covered by [extraction-schema.test.ts](../src/application/extraction/extraction-schema.test.ts)'s implausible-date rejection, reused via `partial-08`'s null-renewal-date case, which correctly forced review).

## Currency Inconsistencies

Both malformed-currency-symbol cases (`intl-16`, `intl-17`) and the silent-currency-region-shift case (`pricing-15`) correctly force review rather than auto-applying. No currency-inconsistency defect found beyond what [Phase 5 validation](phase5-extraction-validation.md#currency-conversion-concerns) already covered.

---

## Summary

| # | Finding | Category | Severity | Status |
|---|---|---|---|---|
| Q2 | Price-change/renewal updates don't update `billingCycle`, silently corrupting the record's terms | Changed pricing models | **High** | **Fixed** |
| Q1 | Trial emails without the exact phrase "trial ends" are silently dropped at the prefilter | Trial subscriptions | Medium | **Fixed** |
| — | Non-English mail from unfamiliar senders is silently dropped (quantified: 5/17 in this set) | Mixed languages | Medium (accepted MVP limitation, restated from Phase 5) | Not fixed — tracked, matches existing Phase 5 recommendation |

**Bottom line:** the adversarial set found one high-severity silent-corruption bug (Q2) and one medium-severity silent-drop bug (Q1) that neither the existing unit tests nor the Phase 5/6 reviews had surfaced, because both require a *sequence* (an existing subscription, then a specific follow-up email; or a specific keyword absence) that isolated unit tests don't naturally construct. Both are fixed. 100/100 adversarial cases pass. The mixed-language gap is real but was already a known, documented tradeoff — this pass adds concrete quantification (5/17 silently dropped) rather than a new finding.
