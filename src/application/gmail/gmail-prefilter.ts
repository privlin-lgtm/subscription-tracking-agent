import { isKnownBillingSender, SUBSCRIPTION_KEYWORDS } from "@/shared/constants";

export type PrefilterInput = {
  subject: string;
  sender: string;
  snippet: string;
};

export function passesSubscriptionPrefilter(input: PrefilterInput): boolean {
  const haystack = `${input.subject} ${input.snippet}`.toLowerCase();

  if (isKnownBillingSender(input.sender)) {
    return true;
  }

  return SUBSCRIPTION_KEYWORDS.some((keyword) => haystack.includes(keyword));
}
