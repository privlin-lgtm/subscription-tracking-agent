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
    return NextResponse.json(result ?? { processed: 0, skipped: true });
  } catch (error) {
    return jsonError(error);
  }
}
