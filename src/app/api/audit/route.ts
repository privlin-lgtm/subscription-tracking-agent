import { NextResponse } from "next/server";
import { jsonError, requireUserId } from "@/infrastructure/http/api";
import { app } from "@/infrastructure/composition";

export async function GET(request: Request) {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) {
    return userId;
  }
  try {
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? "50");
    const items = await app.subscriptionService.listAudit(userId, Number.isFinite(limit) ? limit : 50);
    return NextResponse.json({ items });
  } catch (error) {
    return jsonError(error);
  }
}
