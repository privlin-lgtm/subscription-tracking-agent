import { NextResponse } from "next/server";
import { jsonError, requireUserId } from "@/infrastructure/http/api";
import { app } from "@/infrastructure/composition";

export async function GET(request: Request) {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) {
    return userId;
  }
  try {
    const days = Number(new URL(request.url).searchParams.get("days") ?? "30");
    const items = await app.subscriptionService.listUpcomingRenewals(userId, days);
    return NextResponse.json({ items });
  } catch (error) {
    return jsonError(error);
  }
}
