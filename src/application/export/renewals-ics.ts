import { formatMinorAmount } from "@/domain/value-objects/money";
import { addUtcDays, type RenewalOccurrence } from "@/application/subscriptions/renewal-calendar";

const CRLF = "\r\n";
const MAX_LINE_OCTETS = 75;
const UID_DOMAIN = "subscription-tracker.local";

/**
 * RFC 5545 TEXT escaping. Vendor names come from email, so anything that could start a new
 * content line (CR, LF) or a new property parameter is neutralised here: line breaks become
 * the literal two characters `\n`, other control characters are dropped.
 */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

/**
 * Folds a content line to at most 75 octets (RFC 5545 section 3.1), never splitting a
 * multi-byte UTF-8 character. Continuation lines start with one space.
 */
export function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= MAX_LINE_OCTETS) {
    return line;
  }
  const parts: string[] = [];
  let current = "";
  let currentOctets = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    // Continuation lines spend one octet on the leading space.
    const limit = parts.length === 0 ? MAX_LINE_OCTETS : MAX_LINE_OCTETS - 1;
    if (currentOctets + size > limit) {
      parts.push(current);
      current = "";
      currentOctets = 0;
    }
    current += char;
    currentOctets += size;
  }
  parts.push(current);
  return parts.join(`${CRLF} `);
}

function compactDate(dateKey: string): string {
  return dateKey.replace(/-/g, "");
}

function utcStamp(date: Date): string {
  return `${date.toISOString().slice(0, 19).replace(/[-:]/g, "")}Z`;
}

/**
 * Stable per subscription and day, so importing a fresh download updates the same events
 * in a calendar app instead of duplicating them.
 */
export function renewalUid(occurrence: Pick<RenewalOccurrence, "subscriptionId" | "dateKey">): string {
  const safeId = occurrence.subscriptionId.replace(/[^A-Za-z0-9_-]/g, "");
  return `renewal-${safeId}-${compactDate(occurrence.dateKey)}@${UID_DOMAIN}`;
}

export type RenewalsIcsOptions = {
  /** Used for DTSTAMP. */
  now: Date;
  calendarName?: string;
};

/** Builds an iCalendar file with one all-day event per renewal. */
export function buildRenewalsIcs(occurrences: RenewalOccurrence[], options: RenewalsIcsOptions): string {
  const stamp = utcStamp(options.now);
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Subscription Tracker//Renewals//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(options.calendarName ?? "Subscription renewals")}`,
  ];

  for (const occurrence of occurrences) {
    const amount = `${formatMinorAmount(occurrence.amountCents, occurrence.currency)} ${occurrence.currency}`;
    const nextDay = addUtcDays(new Date(`${occurrence.dateKey}T00:00:00.000Z`), 1).toISOString().slice(0, 10);
    const description = [
      `${occurrence.vendor} renews for ${amount} (${occurrence.billingCycle.toLowerCase()}).`,
      occurrence.projected
        ? "Estimated from the billing cycle. The date or price may change."
        : "Renewal date on record in Subscription Tracker.",
    ].join("\n");

    lines.push(
      "BEGIN:VEVENT",
      `UID:${renewalUid(occurrence)}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compactDate(occurrence.dateKey)}`,
      // DTEND is exclusive for all-day events.
      `DTEND;VALUE=DATE:${compactDate(nextDay)}`,
      `SUMMARY:${escapeIcsText(`${occurrence.vendor} renews (${amount})`)}`,
      `DESCRIPTION:${escapeIcsText(description)}`,
      "CATEGORIES:Subscriptions",
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");
  return lines.map(foldIcsLine).join(CRLF) + CRLF;
}
