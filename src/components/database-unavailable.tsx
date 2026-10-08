"use client";

/**
 * Full-page outage screen shown when PostgreSQL cannot be reached.
 *
 * Rendered in two places:
 *   - `app/(admin)/layout.tsx`, when the session lookup fails to connect. The
 *     layout runs before any page renders, so it is the first place an outage
 *     surfaces.
 *   - `app/error.tsx`, as a fallback when an unavailable database reaches the
 *     error boundary some other way.
 *
 * Deliberately takes NO props and names nothing about the failure. This screen
 * renders before authentication, and React serializes client-component props
 * into the HTML, so anything passed in would be readable by anonymous visitors.
 * The content is fixed: a badge, a heading, one sentence, and a retry.
 *
 * Client component so "Try again" can reload in place; a database outage
 * recovers without restarting the server, because the pool reconnects on the
 * next request.
 */
export function DatabaseUnavailable() {
  return (
    <div className="outage-wrap">
      <div className="outage-card" id="main-content" role="alert">
        <span className="outage-badge">Database offline</span>
        <h1>Cannot reach the database</h1>
        <p className="outage-lead">
          Nothing that reads or writes data will work until it is reachable again. The web server
          itself is running normally.
        </p>
        <button
          className="btn btn-primary outage-retry"
          type="button"
          onClick={() => window.location.reload()}
        >
          Try again
        </button>
      </div>
    </div>
  );
}
