import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/infrastructure/auth/auth";
import { app } from "@/infrastructure/composition";
import { formatMinorAmount } from "@/domain/value-objects/money";
import {
  buildCalendarMonth,
  formatMonthParam,
  parseMonthParam,
  shiftMonth,
  toDateKey,
  totalsByCurrency,
  weekdayLabels,
  type RenewalOccurrence,
} from "@/application/subscriptions/renewal-calendar";

export const dynamic = "force-dynamic";

const WEEKDAYS = weekdayLabels();
const MONTH_TITLE = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const DAY_TITLE = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

const BUTTON = "rounded-lg border bg-white px-3 py-2 text-sm font-medium text-ink-800 hover:bg-slate-50";

function amountLabel(occurrence: RenewalOccurrence): string {
  return `${formatMinorAmount(occurrence.amountCents, occurrence.currency)} ${occurrence.currency}`;
}

function RenewalChip({ occurrence }: { occurrence: RenewalOccurrence }) {
  return (
    <Link
      className={`block rounded-md border px-1.5 py-1 text-xs leading-tight hover:border-accent-500 ${
        occurrence.projected
          ? "border-dashed border-slate-300 bg-white text-slate-600"
          : "border-accent-500/30 bg-accent-500/10 text-ink-900"
      }`}
      href={`/subscriptions/${occurrence.subscriptionId}`}
      title={`${occurrence.vendor}, ${amountLabel(occurrence)}${occurrence.projected ? " (estimated)" : ""}`}
    >
      <span className="block truncate font-medium">{occurrence.vendor}</span>
      <span className="block truncate text-slate-500">{amountLabel(occurrence)}</span>
    </Link>
  );
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string | string[] }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const params = await searchParams;
  const today = new Date();
  const todayKey = toDateKey(today);
  const current = { year: today.getUTCFullYear(), month: today.getUTCMonth() + 1 };
  const requested = parseMonthParam(Array.isArray(params.month) ? params.month[0] : params.month) ?? current;
  const calendar = buildCalendarMonth(requested.year, requested.month);

  const occurrences = await app.subscriptionService.listRenewalOccurrences(
    session.user.id,
    calendar.gridStart,
    calendar.gridEnd,
  );
  const byDay = new Map<string, RenewalOccurrence[]>();
  for (const occurrence of occurrences) {
    const list = byDay.get(occurrence.dateKey) ?? [];
    list.push(occurrence);
    byDay.set(occurrence.dateKey, list);
  }

  const monthPrefix = formatMonthParam(requested.year, requested.month);
  const inMonth = occurrences.filter((occurrence) => occurrence.dateKey.startsWith(monthPrefix));
  const totals = totalsByCurrency(inMonth);
  const daysWithRenewals = calendar.weeks
    .flat()
    .filter((day) => day.inMonth && byDay.has(day.dateKey));

  const previous = shiftMonth(requested.year, requested.month, -1);
  const next = shiftMonth(requested.year, requested.month, 1);
  const title = MONTH_TITLE.format(new Date(Date.UTC(requested.year, requested.month - 1, 1)));
  const isCurrentMonth = requested.year === current.year && requested.month === current.month;

  return (
    <main className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Renewal calendar</h1>
          <p className="mt-1 text-sm text-slate-600">
            When your active subscriptions renew. Later dates are estimated from each billing cycle.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a className={BUTTON} href="/api/export/renewals.ics">
            Download renewals (.ics)
          </a>
          <a className={BUTTON} href="/api/export/subscriptions.csv">
            Export subscriptions (CSV)
          </a>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-medium" data-testid="calendar-month">
          {title}
        </h2>
        <nav aria-label="Change month" className="flex items-center gap-2">
          <Link
            aria-label="Previous month"
            className={BUTTON}
            href={`/calendar?month=${formatMonthParam(previous.year, previous.month)}`}
          >
            ← Previous
          </Link>
          {isCurrentMonth ? null : (
            <Link className={BUTTON} href="/calendar">
              Today
            </Link>
          )}
          <Link
            aria-label="Next month"
            className={BUTTON}
            href={`/calendar?month=${formatMonthParam(next.year, next.month)}`}
          >
            Next →
          </Link>
        </nav>
      </div>

      <section className="rounded-xl border bg-white p-4">
        <p className="text-sm text-slate-500">Renewing in {title}</p>
        {totals.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No renewals this month.</p>
        ) : (
          <div className="mt-2 space-y-1">
            {totals.length > 1 ? (
              <p className="text-sm font-medium text-amber-700">Mixed currencies — totals are not combined.</p>
            ) : null}
            <div className="flex flex-wrap gap-x-8 gap-y-1">
              {totals.map((row) => (
                <p className="text-lg font-semibold" key={row.currency}>
                  {formatMinorAmount(row.totalCents, row.currency)} {row.currency}
                  <span className="ml-2 text-sm font-normal text-slate-500">
                    ({row.count} {row.count === 1 ? "renewal" : "renewals"})
                  </span>
                </p>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Month grid, from tablet width up. */}
      <section aria-label={`${title} calendar`} className="hidden overflow-hidden rounded-xl border bg-white md:block">
        <div className="grid grid-cols-7 border-b bg-slate-50 text-xs font-medium text-slate-500">
          {WEEKDAYS.map((weekday) => (
            <div className="px-2 py-2" key={weekday}>
              {weekday}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {calendar.weeks.flat().map((day, index) => {
            const items = byDay.get(day.dateKey) ?? [];
            const isToday = day.dateKey === todayKey;
            return (
              <div
                className={`min-h-28 min-w-0 space-y-1 border-b p-1.5 ${index % 7 === 6 ? "" : "border-r"} ${
                  day.inMonth ? "" : "bg-slate-50/70"
                } ${index >= (calendar.weeks.length - 1) * 7 ? "border-b-0" : ""}`}
                data-date={day.dateKey}
                key={day.dateKey}
              >
                <p className="text-right text-xs">
                  <span
                    className={
                      isToday
                        ? "inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-accent-600 px-1 font-semibold text-white"
                        : day.inMonth
                          ? "px-1 text-slate-700"
                          : "px-1 text-slate-400"
                    }
                  >
                    {day.day}
                  </span>
                </p>
                {items.map((occurrence) => (
                  <RenewalChip key={`${occurrence.subscriptionId}-${occurrence.dateKey}`} occurrence={occurrence} />
                ))}
              </div>
            );
          })}
        </div>
      </section>

      {/* Phones get the same month as a list. */}
      <section className="rounded-xl border bg-white p-4 md:hidden">
        {daysWithRenewals.length === 0 ? (
          <p className="text-sm text-slate-500">No renewals this month.</p>
        ) : (
          <ul className="divide-y text-sm">
            {daysWithRenewals.map((day) => (
              <li className="py-3 first:pt-0 last:pb-0" key={day.dateKey}>
                <p className="font-medium">{DAY_TITLE.format(new Date(`${day.dateKey}T00:00:00.000Z`))}</p>
                <ul className="mt-1 space-y-1">
                  {(byDay.get(day.dateKey) ?? []).map((occurrence) => (
                    <li
                      className="flex items-center justify-between gap-3"
                      key={`${occurrence.subscriptionId}-${occurrence.dateKey}`}
                    >
                      <Link className="truncate font-medium text-accent-600" href={`/subscriptions/${occurrence.subscriptionId}`}>
                        {occurrence.vendor}
                      </Link>
                      <span className="shrink-0 text-slate-500">
                        {amountLabel(occurrence)}
                        {occurrence.projected ? " (est.)" : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="hidden flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-500 md:flex">
        <span className="flex items-center gap-2">
          <span className="inline-block h-3 w-5 rounded border border-accent-500/30 bg-accent-500/10" />
          Renewal date on record
        </span>
        <span className="flex items-center gap-2">
          <span className="inline-block h-3 w-5 rounded border border-dashed border-slate-300 bg-white" />
          Estimated from the billing cycle
        </span>
        <span>Dates are shown in UTC.</span>
      </div>
    </main>
  );
}
