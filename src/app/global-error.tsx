"use client";

import { ErrorScreen } from "@/components/error-screen";
import "./globals.css";

/**
 * Last-resort boundary: catches failures in the root layout itself, where
 * `app/error.tsx` cannot help. It must render its own <html> and <body>, and
 * import the stylesheet, because the root layout (which normally does both) is
 * exactly what failed.
 */
export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <ErrorScreen message={error.message} onRetry={reset} />
      </body>
    </html>
  );
}
