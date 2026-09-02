import { NextResponse } from "next/server";
import { jsonError, requireUserId } from "@/infrastructure/http/api";
import { app } from "@/infrastructure/composition";

export async function GET() {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) {
    return userId;
  }
  try {
    const summary = await app.subscriptionService.spendSummary(userId);
    return NextResponse.json({ summary });
  } catch (error) {
    return jsonError(error);
  }
}
