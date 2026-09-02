import { KNOWN_BILLING_DOMAINS, SUBSCRIPTION_KEYWORDS } from "@/shared/constants";

export type PrefilterInput = {
  subject: string;
  sender: string;
  snippet: string;
};

export function passesSubscriptionPrefilter(input: PrefilterInput): boolean {
  const haystack = `${input.subject} ${input.snippet}`.toLowerCase();
  const sender = input.sender.toLowerCase();

  if (KNOWN_BILLING_DOMAINS.some((domain) => sender.includes(domain))) {
    return true;
  }

  return SUBSCRIPTION_KEYWORDS.some((keyword) => haystack.includes(keyword));
}
