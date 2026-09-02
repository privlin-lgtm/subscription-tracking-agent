import { NextResponse } from "next/server";
import { jsonError, requireUserId } from "@/infrastructure/http/api";
import { appConfig } from "@/shared/config";
import { buildGmailAuthUrl, GMAIL_PKCE_COOKIE } from "@/infrastructure/gmail/gmail.client";
import { signOAuthState } from "@/infrastructure/gmail/oauth-state";
import { generatePkce } from "@/infrastructure/gmail/pkce";

export async function GET() {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) {
    return userId;
  }
  try {
    if (!appConfig.googleClientId || !appConfig.googleClientSecret) {
      return NextResponse.json({ error: "Gmail OAuth is not configured" }, { status: 503 });
    }
    const pkce = generatePkce();
    const state = signOAuthState(userId, appConfig.authSecret);
    const url = buildGmailAuthUrl(state, pkce.challenge);
    const response = NextResponse.redirect(url);
    response.cookies.set(GMAIL_PKCE_COOKIE, pkce.verifier, {
      httpOnly: true,
      sameSite: "lax",
      secure: appConfig.authUrl.startsWith("https://"),
      path: "/api/gmail",
      maxAge: 10 * 60,
    });
    return response;
  } catch (error) {
    return jsonError(error);
  }
}
