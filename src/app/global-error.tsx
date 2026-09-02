"use client";

import * as Sentry from "@sentry/nextjs";
import NextError from "next/error";
import { useEffect } from "react";

// Next.js's top-level error boundary: catches errors that escape every route's own
// error.tsx (including errors thrown from the root layout, which no error.tsx can catch).
// Without this file those errors reach the browser console but never Sentry.
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html>
      <body>
        <NextError statusCode={0} />
      </body>
    </html>
  );
}
