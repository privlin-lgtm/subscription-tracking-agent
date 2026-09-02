# Phase 9 — Engineering Review

*Phase 9 output (tool: Claude), per [subscription-tracking-agent-prompts.md](../subscription-tracking-agent-prompts.md), acting as a principal engineer. Reviews the codebase as a whole — maintainability, performance, security, reliability, test coverage, architecture alignment — as of the fixes landed in Phases 5–8, and adds its own independent pass rather than re-summarizing those.*

---

## 1. Critical Issues

**None outstanding.** The two issues that would have belonged here — the transactional-write gap that could silently lose event/price history ([Phase 6, D1](phase6-database-review.md)) and the sender-unverified cancellation auto-apply ([Phase 8, S1](phase8-security-review.md)) — were found and fixed in their respective phases before this review.

## 2. Major Issues

**None outstanding.** The high-severity findings from prior phases (billing-cycle not updated on a price/renewal change — [Phase 7, Q2](phase7-data-quality-validation.md); API error logger leaking raw error objects — [Phase 8, S2](phase8-security-review.md)) are fixed. This pass's own independent check (below) found three additional issues, all Minor, all fixed in this pass rather than left open.

## 3. Minor Issues (found this pass, all fixed)

**M1 — Dead, unreachable branch in `matchSubscription`.** The final `return { kind: "renewal", ... }` fallback in [matching.service.ts](../src/application/subscriptions/matching.service.ts) was logically unreachable: `priceSame && !dateUnchanged` can only hold when `input.renewalDate` is set (since `dateUnchanged` is unconditionally `true` whenever it's absent), which means the earlier `renewal` branch already catches every case that could reach the fallback. Confirmed by the coverage report (0% hit) and by tracing the boolean logic. Silent dead code in a decision function is a real maintainability risk — if the logic above it ever changes, this fallback would silently mask a case that should have thrown or been handled differently, rather than surfacing the gap. **Fixed:** replaced with an explicit `throw new Error("unreachable: ...")`, so the function stays exhaustive for TypeScript but any future change that makes this branch reachable fails loudly instead of silently returning a guess.

**M2 — Reused, unused, and duplicated cents↔major-unit conversion.** `domain/value-objects/money.ts` exports `minorToMajorUnits`, correctly handling non-2-decimal currencies (JPY, KRW, BHD, KWD) — but it had zero callers anywhere in the app. Meanwhile, [subscription.service.ts](../src/application/subscriptions/subscription.service.ts) computed the same conversion twice, inline, as `item.priceAmountCents / 100` — silently wrong for exactly the currencies `minorToMajorUnits` exists to handle correctly. This is [Phase 5 validation finding V4](phase5-extraction-validation.md#currency-conversion-concerns), flagged as low-severity and left unfixed at the time; this pass revisits and closes it now that "implement recommended changes" is in scope. **Fixed:** both call sites (`SubscriptionService.update`, `ReviewService.confirm`) now call `minorToMajorUnits(item.priceAmountCents, item.priceCurrency)` instead of the hardcoded `/100`. New regression test confirms a currency-only edit on a JPY-denominated subscription now computes the correct major-unit amount instead of silently dividing by 100 for a currency where that's wrong.

**M3 — Two defensive branches had no test coverage.** `ReviewService.requirePending`'s "id doesn't exist at all" path (distinct from "exists but isn't pending"), and `SubscriptionService`'s invalid-renewal-date rejection, were both reachable, correct code with no test exercising them — coverage gaps that happened to sit on error paths, the ones most likely to silently rot. **Fixed:** added one test for each.

None of M1–M3 changed observable behavior for any already-passing case (confirmed: full suite — 228 tests — passes unchanged in count of pre-existing tests, plus the new ones).

## 4. Refactoring Suggestions (not implemented — judgment calls, not defects)

- **`worker.ts`'s Gmail-sync loop is serial across users**, `for (const userId of userIds) { await ... syncUser(userId) }`. Unlike the `AlertJobs` queries fixed in Phase 6, this genuinely can't be collapsed into one query — each user's sync is an independent OAuth-authenticated call sequence against Gmail. It could still be parallelized with a bounded concurrency limit to cut wall-clock time at scale; left as-is here because it's a scale question, not a correctness one, and belongs with [Phase 10's scalability review](phase10-scalability-review.md) rather than a code-quality fix made in isolation.
- **`AesGcmTokenEncryptor`'s static KDF salt** ([Phase 8, S4](phase8-security-review.md)) — documented, deliberately not changed without a clearer need.
- **Per-subscription learned sender trust** instead of the small global `KNOWN_BILLING_DOMAINS` allowlist ([Phase 8, S5](phase8-security-review.md)) — the more precise long-term fix for cancellation/renewal sender verification, scoped out because it needs a schema migration this pass didn't want to bundle into a security fix.
- **Vendor-alias learning from confirmed reviews** ([Phase 5 validation, V1](phase5-extraction-validation.md#accuracy-of-vendor-detection)) — still open, still a reasonable "defer until real usage data" call.

## 5. Test Coverage

Current numbers (`npm run test:coverage`, application/domain/shared/Gmail-parse scope, matching the exclusions documented in the [Phase 7 decisions](../README.md#phase-7-decisions)):

| Metric | Coverage |
|---|---|
| Statements | 97.78% |
| Branches | 88.59% |
| Functions | 93.47% |
| Lines | 97.78% |

225 tests before this review's additions, 228 after (M3's two new tests plus the M2 regression test). All passing; `tsc --noEmit`, `eslint`, and `next build` are clean. The branch-coverage number (88.59%) is the softest of the four — largely defensive `catch` blocks around repository-write failures (e.g. `createPendingReview`'s conflict handling) that are correct but awkward to trigger without a repository double designed specifically to fail on command; not chased further here since none turned out to hide a real defect when traced by hand (M1–M3 aside, which were found by tracing, not by coverage percentage alone).

## 6. Architecture Alignment

The implementation tracks the [Phase 1 architecture](architecture.md) and [Phase 2 technical design](technical-design.md) closely, with deviations that are each an explicit, documented decision rather than drift:
- The Phase 1 architecture's `no_match`/`renewal`/`price_change`/`duplicate`/`currency_mismatch` decision shape maps directly onto `matchSubscription`'s actual `MatchDecision` union.
- The layered structure (`domain` → `application` → `infrastructure`) is followed consistently; no application-layer code imports Prisma types directly, no domain-layer code imports Next.js or infrastructure types.
- Every deviation from the original design that this review is aware of is a phase-decision write-up, not silent drift: cancellation detection (not in the original Phase 2 schema) was added in Phase 5 with its own design note; the `applyWrite` transactional helper (not in the original schema either) was added in Phase 6 in direct response to a review finding.

## 7. Release Recommendation

**Engineering-ready.** No critical or major issues remain open; the three minor issues found in this pass are fixed, not deferred. Test coverage is strong and the suite is fast (~35s for 228 tests). This review's scope is code quality, not business/operational readiness — the two open items that actually matter for a launch decision (S5's residual sender-trust gap, and the "at 10k users" scaling question the Phase 1 doc already flagged) are correctly upstream from Phase 11, not down to code quality, and are picked up next in [Phase 10](phase10-scalability-review.md) and the [Pre-Release Audit](phase11-pre-release-audit.md).
