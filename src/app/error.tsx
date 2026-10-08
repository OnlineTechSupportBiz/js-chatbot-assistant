"use client";

import { ErrorScreen } from "@/components/error-screen";

/**
 * Error boundary for the whole app (every route below the root layout).
 *
 * Catches render failures from pages and from group layouts such as
 * `(admin)/layout.tsx`, which is where a database outage surfaces first: the
 * session lookup needs the DB, so the admin area fails before any page runs.
 *
 * Renders a real page instead of the Next.js error overlay / unhandled
 * exception screen, and never prints the error itself. Note that this boundary
 * is only a safety net for the database case: `(admin)/layout.tsx` handles an
 * unavailable database directly.
 */
export default function AppError({ error, reset }: { error: Error; reset: () => void }) {
  return <ErrorScreen message={error.message} onRetry={reset} />;
}
