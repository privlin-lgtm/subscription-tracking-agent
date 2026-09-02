import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { auth } from "@/infrastructure/auth/auth";
import { DomainError } from "@/domain/errors";

export async function requireUserId(): Promise<string | NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return session.user.id;
}

export function jsonError(error: unknown): NextResponse {
  if (error instanceof DomainError) {
    const status =
      error.code === "NOT_FOUND"
        ? 404
        : error.code === "CONFLICT"
          ? 409
          : error.code === "FORBIDDEN"
            ? 403
            : error.code === "GMAIL_AUTH"
              ? 401
              : error.code === "GMAIL_RATE_LIMIT"
                ? 429
                : 400;
    return NextResponse.json({ error: error.message, code: error.code }, { status });
  }
  if (error instanceof ZodError) {
    return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }
  // Log only the message, never the raw error object: client libraries for third-party APIs
  // (notably Gaxios/googleapis, used for Gmail) commonly attach the full outgoing request —
  // including Authorization headers and request bodies — to error.config/error.response, so
  // console.error(error) risks writing access/refresh tokens straight into server logs.
  console.error(error instanceof Error ? error.message : "unknown error");
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

