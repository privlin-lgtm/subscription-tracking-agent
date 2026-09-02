import { NextResponse } from "next/server";
import { jsonError, requireUserId } from "@/infrastructure/http/api";
import { app } from "@/infrastructure/composition";

/**
 * Permanently deletes the signed-in user's account. Every owned row (subscriptions, events,
 * price changes, notifications, review decisions, email snapshots, processed-email ledger,
 * and the audit log itself) cascades via the schema's onDelete: Cascade -- see
 * docs/phase11-pre-release-audit.md for why this exists (GDPR Article 17 / right to erasure
 * had no user-facing trigger before this route).
 */
export async function DELETE() {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) {
    return userId;
  }
  try {
    await app.users.deleteAccount(userId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
