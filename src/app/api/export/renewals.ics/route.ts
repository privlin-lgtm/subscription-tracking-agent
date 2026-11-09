import { NextResponse } from "next/server";
import { buildRenewalsIcs } from "@/application/export/renewals-ics";
import { addUtcDays, utcDay } from "@/application/subscriptions/renewal-calendar";
import { ValidationError } from "@/domain/errors";
import { jsonError, requireUserId } from "@/infrastructure/http/api";
import { app } from "@/infrastructure/composition";

export const dynamic = "force-dynamic";

const DEFAULT_DAYS = 90;
const MAX_DAYS = 365;

/** Downloads the signed-in user's renewals for the next `days` days (default 90) as iCalendar. */
export async function GET(request: Request) {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) {
    return userId;
  }
  try {
    const raw = new URL(request.url).searchParams.get("days");
    const days = raw === null ? DEFAULT_DAYS : Number(raw);
    if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
      throw new ValidationError(`Renewal window must be between 1 and ${MAX_DAYS} days`);
    }
    const now = new Date();
    const from = utcDay(now);
    const occurrences = await app.subscriptionService.listRenewalOccurrences(userId, from, addUtcDays(from, days));
    return new NextResponse(buildRenewalsIcs(occurrences, { now }), {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'attachment; filename="subscription-renewals.ics"',
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
