import { NextResponse } from "next/server";
import { jsonError, requireUserId } from "@/infrastructure/http/api";
import { app } from "@/infrastructure/composition";

export async function GET() {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) {
    return userId;
  }
  try {
    const items = await app.notifications.listByUser(userId);
    return NextResponse.json({ items });
  } catch (error) {
    return jsonError(error);
  }
}
