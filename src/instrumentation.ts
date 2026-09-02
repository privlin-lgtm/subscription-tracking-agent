import * as Sentry from "@sentry/nextjs";

// Registers the Sentry SDK for whichever server runtime this app instance is running
// under. Next.js calls this once per runtime at boot (Node.js for the standard server,
// edge for middleware/edge routes) -- see sentry.server.config.ts and sentry.edge.config.ts
// for the actual Sentry.init() calls.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Reports errors thrown inside Server Components, Route Handlers, and Server Actions
// that Next.js's own error handling would otherwise swallow before they reach Sentry.
export const onRequestError = Sentry.captureRequestError;
