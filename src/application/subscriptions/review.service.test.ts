import { EventType, ReviewDecisionType, SubscriptionStatus } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import type { ReviewRepository } from "@/domain/repositories";
import { createInMemoryPersistence } from "@/application/subscriptions/in-memory-subscriptions";
import { ReviewService } from "@/application/subscriptions/subscription.service";
import { ValidationError } from "@/domain/errors";

const USER_ID = "user_1";

function service() {
  const { subscriptions, audit } = createInMemoryPersistence();
  const reviews: ReviewRepository = { recordDecision: vi.fn(async () => undefined) };
  return { subscriptions, audit, reviews, svc: new ReviewService(subscriptions, reviews) };
}

async function seedPendingReview(subscriptions: ReturnType<typeof createInMemoryPersistence>["subscriptions"]) {
  return subscriptions.create({
    userId: USER_ID,
    vendorNormalized: "Netflix",
    vendorRaw: "Netflix",
    status: SubscriptionStatus.PENDING_REVIEW,
    priceAmountCents: 1549,
    priceCurrency: "USD",
    billingCycle: "MONTHLY",
    nextRenewalDate: null,
    lastSeenEmailId: "msg_1",
    confidenceScore: 0.5,
    reviewReason: "low_confidence",
  });
}

describe("ReviewService", () => {
  it("confirms a pending item atomically: ACTIVE status, REVIEW_CONFIRMED event, and audit row together", async () => {
    const { svc, subscriptions, audit, reviews } = service();
    const created = await seedPendingReview(subscriptions);

    const updated = await svc.confirm(USER_ID, created.id);

    expect(updated.status).toBe(SubscriptionStatus.ACTIVE);
    expect(updated.reviewReason).toBeNull();
    expect(subscriptions.events).toEqual([
      expect.objectContaining({ subscriptionId: created.id, eventType: EventType.REVIEW_CONFIRMED }),
    ]);
    expect(await audit.listByUser(USER_ID)).toEqual([
      expect.objectContaining({ action: "review.confirm" }),
    ]);
    expect(reviews.recordDecision).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionId: created.id, decision: ReviewDecisionType.CONFIRM }),
    );
  });

  it("records EDIT_AND_CONFIRM when the reviewer changes a field while confirming", async () => {
    const { svc, subscriptions, reviews } = service();
    const created = await seedPendingReview(subscriptions);

    await svc.confirm(USER_ID, created.id, { priceAmount: 17.99 });

    expect(reviews.recordDecision).toHaveBeenCalledWith(
      expect.objectContaining({ decision: ReviewDecisionType.EDIT_AND_CONFIRM }),
    );
  });

  it("dismisses a pending item atomically: DISMISSED status, REVIEW_DISMISSED event, and audit row together", async () => {
    const { svc, subscriptions, audit, reviews } = service();
    const created = await seedPendingReview(subscriptions);

    const updated = await svc.dismiss(USER_ID, created.id, "not mine");

    expect(updated.status).toBe(SubscriptionStatus.DISMISSED);
    expect(updated.reviewReason).toBe("not mine");
    expect(subscriptions.events).toEqual([
      expect.objectContaining({ subscriptionId: created.id, eventType: EventType.REVIEW_DISMISSED }),
    ]);
    expect(await audit.listByUser(USER_ID)).toEqual([
      expect.objectContaining({ action: "review.dismiss" }),
    ]);
    expect(reviews.recordDecision).toHaveBeenCalledWith(
      expect.objectContaining({ decision: ReviewDecisionType.DISMISS }),
    );
  });

  it("rejects resolving an item that isn't pending review", async () => {
    const { svc, subscriptions } = service();
    const created = await seedPendingReview(subscriptions);
    await svc.confirm(USER_ID, created.id);

    await expect(svc.confirm(USER_ID, created.id)).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.dismiss(USER_ID, created.id)).rejects.toBeInstanceOf(ValidationError);
  });
});
