import * as Sentry from "@sentry/nextjs";

// Runs in the browser. This file's name is a Next.js convention (like middleware.ts) --
// Next.js loads it automatically, no wiring needed in instrumentation.ts.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
  environment: process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
  debug: false,
});

// Reports client-side navigation errors (e.g. a route that fails to load) to Sentry.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
