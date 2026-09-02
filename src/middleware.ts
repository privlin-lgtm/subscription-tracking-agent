import { NextResponse } from "next/server";
import NextAuth from "next-auth";
import { authConfig } from "@/infrastructure/auth/auth.config";

const { auth } = NextAuth(authConfig);

const PUBLIC_PATHS = new Set(["/", "/login", "/register"]);

export default auth((request) => {
  const { pathname } = request.nextUrl;
  const isPublic =
    PUBLIC_PATHS.has(pathname) ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/health") ||
    pathname.startsWith("/api/gmail/callback");

  if (!request.auth && !isPublic && !pathname.startsWith("/_next")) {
    const login = new URL("/login", request.nextUrl.origin);
    login.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(login);
  }

  if (request.auth && (pathname === "/login" || pathname === "/register")) {
    return NextResponse.redirect(new URL("/dashboard", request.nextUrl.origin));
  }
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
