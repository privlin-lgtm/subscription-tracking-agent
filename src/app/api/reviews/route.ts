import { NextResponse } from "next/server";
import { jsonError, requireUserId } from "@/infrastructure/http/api";
import { app } from "@/infrastructure/composition";

export async function GET() {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) {
    return userId;
  }
  try {
    const items = await app.reviewService.listPending(userId);
    const withSnapshots = await Promise.all(
      items.map(async (item) => {
        const snapshot = item.lastSeenEmailId
          ? await app.snapshots.get(userId, item.lastSeenEmailId)
          : null;
        return { ...item, snapshot };
      }),
    );
    return NextResponse.json({ items: withSnapshots });
  } catch (error) {
    return jsonError(error);
  }
}
