import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/infrastructure/auth/auth";
import { app } from "@/infrastructure/composition";
import { appConfig } from "@/shared/config";
import { exchangeGmailCode, GMAIL_PKCE_COOKIE } from "@/infrastructure/gmail/gmail.client";
import { verifyOAuthState } from "@/infrastructure/gmail/oauth-state";

function denied(request: Request) {
  return NextResponse.redirect(new URL("/settings?gmail=denied", request.url));
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const cookieStore = await cookies();
  const codeVerifier = cookieStore.get(GMAIL_PKCE_COOKIE)?.value;

  if (error || !code || !state || !codeVerifier) {
    return denied(request);
  }

  try {
    verifyOAuthState(state, session.user.id, appConfig.authSecret);
    const refreshToken = await exchangeGmailCode(code, codeVerifier);
    await app.gmailSync.connect(session.user.id, refreshToken);
    const response = NextResponse.redirect(new URL("/settings?gmail=connected", request.url));
    response.cookies.set(GMAIL_PKCE_COOKIE, "", { path: "/api/gmail", maxAge: 0 });
    return response;
  } catch {
    const response = denied(request);
    response.cookies.set(GMAIL_PKCE_COOKIE, "", { path: "/api/gmail", maxAge: 0 });
    return response;
  }
}
