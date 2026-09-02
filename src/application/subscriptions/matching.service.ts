import { Money } from "@/domain/value-objects/money";
import type { SubscriptionRecord } from "@/domain/repositories";

export type MatchDecision =
  | { kind: "no_match" }
  | { kind: "duplicate"; subscription: SubscriptionRecord }
  | { kind: "renewal"; subscription: SubscriptionRecord }
  | { kind: "price_change"; subscription: SubscriptionRecord }
  | { kind: "currency_mismatch"; subscription: SubscriptionRecord };

export function matchSubscription(input: {
  candidates: SubscriptionRecord[];
  vendorNormalized: string;
  money: Money;
  renewalDate: Date | null;
}): MatchDecision {
  const vendorKey = input.vendorNormalized.toLowerCase();
  const candidate = input.candidates.find(
    (item) =>
      item.vendorNormalized.toLowerCase() === vendorKey &&
      item.status !== "DISMISSED" &&
      item.status !== "CANCELED",
  );

  if (!candidate) {
    return { kind: "no_match" };
  }

  if (candidate.priceCurrency !== input.money.currency) {
    return { kind: "currency_mismatch", subscription: candidate };
  }

  const existingMoney = new Money(candidate.priceAmountCents, candidate.priceCurrency);
  const priceSame = existingMoney.approximatelyEquals(input.money);
  const dateUnchanged =
    !input.renewalDate ||
    !candidate.nextRenewalDate ||
    sameUtcDay(candidate.nextRenewalDate, input.renewalDate);

  if (priceSame && dateUnchanged) {
    return { kind: "duplicate", subscription: candidate };
  }
  if (priceSame && input.renewalDate && !dateUnchanged) {
    return { kind: "renewal", subscription: candidate };
  }
  if (!priceSame) {
    return { kind: "price_change", subscription: candidate };
  }

  return { kind: "renewal", subscription: candidate };
}

function sameUtcDay(a: Date, b: Date): boolean {
  return a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
}
