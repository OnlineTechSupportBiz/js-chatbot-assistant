"use client";

import { DB_UNAVAILABLE_MESSAGE } from "@/lib/db-errors";
import { DatabaseUnavailable } from "./database-unavailable";

/**
 * Shared error-boundary screen for `app/error.tsx` and `app/global-error.tsx`.
 *
 * Next.js sanitizes Server Component error messages in production builds, so
 * this cannot rely on inspecting the error: it branches only on the one message
 * we control (`DB_UNAVAILABLE_MESSAGE`, set by `lib/db-errors.ts`) and
 * otherwise shows a generic failure.
 *
 * Neither branch prints the error message, a stack, or any identifying detail.
 * This screen can render before authentication, so internals stay in the server
 * log and never reach the browser.
 */
export interface ErrorScreenProps {
  /** `error.message` from the boundary. Used only to choose the branch. */
  message: string;
  /** The boundary's `reset()`. */
  onRetry: () => void;
}

export function ErrorScreen({ message, onRetry }: ErrorScreenProps) {
  if (message === DB_UNAVAILABLE_MESSAGE) {
    return <DatabaseUnavailable />;
  }

  return (
    <div className="outage-wrap">
      <div className="outage-card" id="main-content" role="alert">
        <span className="outage-badge outage-badge-danger">Error</span>
        <h1>Something went wrong</h1>
        <p className="outage-lead">This page could not be loaded. Please try again in a moment.</p>
        <button className="btn btn-primary outage-retry" type="button" onClick={onRetry}>
          Try again
        </button>
      </div>
    </div>
  );
}
