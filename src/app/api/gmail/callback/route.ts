import { NextResponse } from "next/server";
import { auth } from "@/infrastructure/auth/auth";
import { app } from "@/infrastructure/composition";
import { exchangeGmailCode } from "@/infrastructure/gmail/gmail.client";
import { jsonError } from "@/infrastructure/http/api";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error || !code || state !== session.user.id) {
    return NextResponse.redirect(new URL("/settings?gmail=denied", request.url));
  }

  try {
    const refreshToken = await exchangeGmailCode(code);
    const encrypted = app.encryptor.encrypt(refreshToken);
    await app.users.updateGmailConnection(session.user.id, {
      gmailRefreshToken: encrypted,
      gmailConnected: true,
      gmailDisconnectedAt: null,
    });
    return NextResponse.redirect(new URL("/settings?gmail=connected", request.url));
  } catch (err) {
    return jsonError(err);
  }
}
