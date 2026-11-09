import { BillingCycle } from "@prisma/client";
import type { SubscriptionRecord } from "@/domain/repositories";

/**
 * One renewal on one calendar day. Dates are calendar days in UTC, matching how the rest of
 * the app shows `nextRenewalDate` (`toISOString().slice(0, 10)`).
 */
export type RenewalOccurrence = {
  subscriptionId: string;
  vendor: string;
  /** `YYYY-MM-DD` */
  dateKey: string;
  amountCents: number;
  currency: string;
  billingCycle: BillingCycle;
  /**
   * False for the renewal date we actually store. True for later dates worked out from the
   * billing cycle, which are estimates: the price or the date can change before then.
   */
  projected: boolean;
};

export type CalendarDay = {
  dateKey: string;
  day: number;
  inMonth: boolean;
};

export type CalendarMonth = {
  year: number;
  /** 1-12 */
  month: number;
  /** Weeks starting on `WEEK_STARTS_ON`, padded with the neighbouring months' days. */
  weeks: CalendarDay[][];
  /** First and last day shown on the grid, inclusive. */
  gridStart: Date;
  gridEnd: Date;
};

/**
 * First column of the calendar, as a `Date#getUTCDay()` index (0 = Sunday, 1 = Monday).
 * The one place to change, or to replace with a per-user setting later.
 */
export const WEEK_STARTS_ON: number = 0;

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Column headings in display order for a given week start. */
export function weekdayLabels(weekStartsOn: number = WEEK_STARTS_ON): string[] {
  return WEEKDAY_LABELS.map((_label, index) => WEEKDAY_LABELS[(index + weekStartsOn) % 7]);
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Guards the projection loop; a weekly subscription across a full year is 53 occurrences. */
const MAX_OCCURRENCES_PER_SUBSCRIPTION = 400;

export function utcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addUtcDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/**
 * Adds whole months to a UTC day, clamping to the last day of the target month, so a
 * subscription billed on the 31st lands on 28/29 Feb and returns to the 31st afterwards.
 */
export function addUtcMonthsClamped(anchor: Date, months: number): Date {
  const targetMonthIndex = anchor.getUTCMonth() + months;
  const year = anchor.getUTCFullYear() + Math.floor(targetMonthIndex / 12);
  const month = ((targetMonthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(anchor.getUTCDate(), lastDay)));
}

function occurrenceDate(anchor: Date, cycle: BillingCycle, step: number): Date | null {
  if (step === 0) {
    return anchor;
  }
  switch (cycle) {
    case BillingCycle.WEEKLY:
      return addUtcDays(anchor, step * 7);
    case BillingCycle.MONTHLY:
      return addUtcMonthsClamped(anchor, step);
    case BillingCycle.ANNUAL:
      return addUtcMonthsClamped(anchor, step * 12);
    default:
      // CUSTOM has no known interval, so only the stored date is shown.
      return null;
  }
}

/**
 * Lists every renewal that falls between `from` and `to` (inclusive, by UTC day): the stored
 * next renewal date, plus later dates projected from the billing cycle. Never projects
 * backwards from the stored date. Callers pass the subscriptions they want included (the
 * service passes ACTIVE ones only).
 */
export function projectRenewals(
  subscriptions: SubscriptionRecord[],
  from: Date,
  to: Date,
): RenewalOccurrence[] {
  const start = utcDay(from).getTime();
  const end = utcDay(to).getTime();
  const occurrences: RenewalOccurrence[] = [];

  for (const subscription of subscriptions) {
    if (!subscription.nextRenewalDate) {
      continue;
    }
    const anchor = utcDay(subscription.nextRenewalDate);
    for (let step = 0; step < MAX_OCCURRENCES_PER_SUBSCRIPTION; step += 1) {
      const date = occurrenceDate(anchor, subscription.billingCycle, step);
      if (!date || date.getTime() > end) {
        break;
      }
      if (date.getTime() >= start) {
        occurrences.push({
          subscriptionId: subscription.id,
          vendor: subscription.vendorNormalized,
          dateKey: toDateKey(date),
          amountCents: subscription.priceAmountCents,
          currency: subscription.priceCurrency,
          billingCycle: subscription.billingCycle,
          projected: step > 0,
        });
      }
    }
  }

  return occurrences.sort(
    (a, b) =>
      a.dateKey.localeCompare(b.dateKey) ||
      a.vendor.localeCompare(b.vendor) ||
      a.subscriptionId.localeCompare(b.subscriptionId),
  );
}

/** Parses `YYYY-MM`; returns null for anything else so callers can fall back to today. */
export function parseMonthParam(value: string | null | undefined): { year: number; month: number } | null {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value ?? "");
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  if (year < 2000 || year > 2100) {
    return null;
  }
  return { year, month: Number(match[2]) };
}

export function formatMonthParam(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const shifted = addUtcMonthsClamped(new Date(Date.UTC(year, month - 1, 1)), delta);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1 };
}

export function buildCalendarMonth(
  year: number,
  month: number,
  weekStartsOn: number = WEEK_STARTS_ON,
): CalendarMonth {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const last = new Date(Date.UTC(year, month, 0));
  // Column of a day = how many days it sits after the week's first day.
  const leading = (first.getUTCDay() - weekStartsOn + 7) % 7;
  const trailing = 6 - ((last.getUTCDay() - weekStartsOn + 7) % 7);
  const gridStart = addUtcDays(first, -leading);
  const gridEnd = addUtcDays(last, trailing);

  const weeks: CalendarDay[][] = [];
  for (let cursor = gridStart; cursor.getTime() <= gridEnd.getTime(); cursor = addUtcDays(cursor, 7)) {
    const week: CalendarDay[] = [];
    for (let offset = 0; offset < 7; offset += 1) {
      const date = addUtcDays(cursor, offset);
      week.push({
        dateKey: toDateKey(date),
        day: date.getUTCDate(),
        inMonth: date.getUTCMonth() === month - 1,
      });
    }
    weeks.push(week);
  }
  return { year, month, weeks, gridStart, gridEnd };
}

export type CurrencyTotal = { currency: string; totalCents: number; count: number };

/** Per-currency totals. Currencies are never combined: there is no FX conversion in this app. */
export function totalsByCurrency(occurrences: RenewalOccurrence[]): CurrencyTotal[] {
  const totals = new Map<string, CurrencyTotal>();
  for (const occurrence of occurrences) {
    const row = totals.get(occurrence.currency) ?? { currency: occurrence.currency, totalCents: 0, count: 0 };
    row.totalCents += occurrence.amountCents;
    row.count += 1;
    totals.set(occurrence.currency, row);
  }
  return [...totals.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}
