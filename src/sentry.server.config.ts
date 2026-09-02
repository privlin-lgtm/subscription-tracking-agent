import * as Sentry from "@sentry/nextjs";

// Runs in the Node.js server runtime (API routes, Server Components, Server Actions,
// the app's normal request handling). Loaded from instrumentation.ts's register().
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // No DSN configured (e.g. local dev without a Sentry project) -- disable rather than
  // erroring, so the app runs fine without Sentry set up.
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
  environment: process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
  debug: false,
});
