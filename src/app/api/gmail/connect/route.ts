import { NextResponse } from "next/server";
import { jsonError, requireUserId } from "@/infrastructure/http/api";
import { buildGmailAuthUrl } from "@/infrastructure/gmail/gmail.client";

export async function GET() {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) {
    return userId;
  }
  try {
    const url = buildGmailAuthUrl(userId);
    return NextResponse.redirect(url);
  } catch (error) {
    return jsonError(error);
  }
}
