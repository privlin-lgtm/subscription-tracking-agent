import type { SubscriptionRecord } from "@/domain/repositories";
import { formatMinorAmount } from "@/domain/value-objects/money";

const CRLF = "\r\n";
/** Lets Excel open the file as UTF-8 so non-ASCII vendor names survive. */
export const CSV_BOM = "﻿";

export const SUBSCRIPTION_CSV_HEADER = [
  "Vendor",
  "Status",
  "Price",
  "Currency",
  "Billing cycle",
  "Next renewal",
  "First tracked",
  "Last updated",
] as const;

/**
 * Spreadsheet apps run a cell as a formula when it starts with = + - @ (or a tab / carriage
 * return before one). Vendor names come from email, so such cells get a leading apostrophe,
 * which makes the spreadsheet treat them as text (OWASP "CSV injection").
 */
export function neutralizeFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/** RFC 4180: quote a field that contains a quote, comma or line break; double the quotes. */
export function escapeCsvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** For free text. Numbers and dates we format ourselves skip the formula guard. */
function textCell(value: string): string {
  return escapeCsvField(neutralizeFormula(value));
}

function dateCell(value: Date | null): string {
  return value ? value.toISOString().slice(0, 10) : "";
}

export function buildSubscriptionsCsv(subscriptions: SubscriptionRecord[]): string {
  const rows = [...subscriptions]
    .sort(
      (a, b) => a.vendorNormalized.localeCompare(b.vendorNormalized) || a.id.localeCompare(b.id),
    )
    .map((item) =>
      [
        textCell(item.vendorNormalized),
        textCell(item.status),
        formatMinorAmount(item.priceAmountCents, item.priceCurrency),
        textCell(item.priceCurrency),
        textCell(item.billingCycle),
        dateCell(item.nextRenewalDate),
        dateCell(item.createdAt),
        dateCell(item.updatedAt),
      ].join(","),
    );
  return CSV_BOM + [SUBSCRIPTION_CSV_HEADER.join(","), ...rows].join(CRLF) + CRLF;
}
