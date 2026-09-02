import type { NextConfig } from "next";
import path from "node:path";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  serverExternalPackages: ["googleapis", "@prisma/client", "bcryptjs"],
  outputFileTracingRoot: path.join(__dirname),
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  // Needed only to upload source maps on build (so stack traces in Sentry show real
  // source instead of minified code) -- unset locally, set in CI/production once the
  // Sentry project exists. `silent` avoids noisy plugin logs when it's absent.
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.SENTRY_AUTH_TOKEN,
  widenClientFileUpload: true,
  disableLogger: true,
  // This app isn't deployed on Vercel; skip Vercel-specific cron monitor instrumentation.
  automaticVercelMonitors: false,
});
