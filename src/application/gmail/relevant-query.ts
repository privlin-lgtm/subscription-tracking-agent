import { KNOWN_BILLING_DOMAINS, SUBSCRIPTION_KEYWORDS } from "@/shared/constants";

export function buildRelevantGmailQuery(after: Date): string {
  const afterEpoch = Math.floor(after.getTime() / 1000);
  const subjectClause = SUBSCRIPTION_KEYWORDS.map(toGmailTerm).join(" OR ");
  const fromClause = KNOWN_BILLING_DOMAINS.map((domain) => `from:${domain}`).join(" OR ");
  return `after:${afterEpoch} ((subject:(${subjectClause})) OR (${fromClause}))`;
}

function toGmailTerm(keyword: string): string {
  return keyword.includes(" ") ? `"${keyword}"` : keyword;
}
