import { NextResponse } from "next/server";
import { jsonError, requireUserId } from "@/infrastructure/http/api";
import { app } from "@/infrastructure/composition";

export async function POST() {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) {
    return userId;
  }
  try {
    const result = await app.locks.withUserLock(userId, () => app.gmailSync.syncUser(userId));
    if (!result) {
      return NextResponse.json({ processed: 0, skipped: true, reason: "lock_not_acquired" });
    }
    return NextResponse.json(result);
  } catch (error) {
    return jsonError(error);
  }
}
