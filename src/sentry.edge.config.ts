import * as Sentry from "@sentry/nextjs";

// Runs in the Edge runtime (middleware.ts, and any route handlers opted into
// `export const runtime = "edge"`). Loaded from instrumentation.ts's register().
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
  environment: process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
  debug: false,
});
