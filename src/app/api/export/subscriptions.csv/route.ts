import { NextResponse } from "next/server";
import { buildSubscriptionsCsv } from "@/application/export/subscriptions-csv";
import { jsonError, requireUserId } from "@/infrastructure/http/api";
import { app } from "@/infrastructure/composition";

export const dynamic = "force-dynamic";

/** Downloads the signed-in user's subscriptions (everything the Subscriptions page lists) as CSV. */
export async function GET() {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) {
    return userId;
  }
  try {
    const items = await app.subscriptionService.list(userId);
    return new NextResponse(buildSubscriptionsCsv(items), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="subscriptions.csv"',
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
