/**
 * Timezone-aware date formatting — port of PHP `App\Util\DateTimeHelper`.
 *
 * Contract (stated by the PHP helper, and what this implements):
 *   "All timestamps in the database are stored in UTC. This helper converts
 *    them to the user's preferred timezone for display."
 *
 * So a stored timestamp is never converted on the way in; only on the way out to
 * the screen. Formats match PHP's exactly:
 *
 *   formatDateTime  'M j, Y g:i A'  ->  "Jul 25, 2026 2:30 PM"
 *   formatDate      'M j, Y'        ->  "Jul 25, 2026"
 *   formatTime      'g:i A'         ->  "2:30 PM"
 *   formatIso       'Y-m-d H:i'     ->  "2026-07-25 14:30"
 *
 * Failure behaviour matches PHP too: an empty value renders an em dash, and any
 * error (unparseable value, unknown timezone) returns the value unchanged rather
 * than throwing. A bad row must never blank out a table cell.
 *
 * Formatting is done with an explicit `en-US` locale, so output does not depend
 * on the browser or server locale, and server and client render identically.
 */

/** PHP's placeholder for an empty timestamp. */
export const EMPTY_DATETIME = "—";

const LOCALE = "en-US";

/**
 * A stored timestamp is UTC. PHP passes it to `DateTimeImmutable` with an
 * explicit UTC zone; JavaScript would read a zone-less string as *local* time, so
 * add the designator. Strings that already carry one (the ISO output of an
 * `api` response, e.g. "...T07:00:00.000Z") are left alone.
 */
function toUtcDate(value: string): Date | null {
  const raw = value.trim();
  if (raw === "") return null;
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(raw);
  const d = new Date(hasZone ? raw : `${raw.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function timeZoneOrUndefined(timeZone: string): string | undefined {
  try {
    new Intl.DateTimeFormat(LOCALE, { timeZone });
    return timeZone;
  } catch {
    return undefined;
  }
}

/** Shared guard: mirrors PHP's empty-value and error handling. */
function attempt(value: string, timeZone: string, render: (d: Date, tz: string) => string): string {
  if (typeof value !== "string" || value.trim() === "") return EMPTY_DATETIME;
  const d = toUtcDate(value);
  if (d === null) return value;
  const tz = timeZoneOrUndefined(timeZone);
  if (tz === undefined) return value;
  try {
    return render(d, tz);
  } catch {
    return value;
  }
}

/** "Jul 25, 2026 2:30 PM" (PHP format 'M j, Y g:i A'). */
export function formatDateTime(value: string, timeZone = "UTC"): string {
  return attempt(value, timeZone, (d, tz) => `${formatDateParts(d, tz)} ${formatTimeParts(d, tz)}`);
}

/** "Jul 25, 2026" (PHP format 'M j, Y'). */
export function formatDate(value: string, timeZone = "UTC"): string {
  return attempt(value, timeZone, (d, tz) => formatDateParts(d, tz));
}

/** "2:30 PM" (PHP format 'g:i A'). */
export function formatTime(value: string, timeZone = "UTC"): string {
  return attempt(value, timeZone, (d, tz) => formatTimeParts(d, tz));
}

/** "2026-07-25 14:30" (PHP format 'Y-m-d H:i'). */
export function formatIso(value: string, timeZone = "UTC"): string {
  return attempt(value, timeZone, (d, tz) => {
    const parts = new Intl.DateTimeFormat(LOCALE, {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(d);
    const get = (type: Intl.DateTimeFormatPartTypes): string =>
      parts.find((p) => p.type === type)?.value ?? "";
    // Intl reports midnight as hour "24" in some ICU versions; PHP's H is 00-23.
    const hour = get("hour") === "24" ? "00" : get("hour");
    return `${get("year")}-${get("month")}-${get("day")} ${hour}:${get("minute")}`;
  });
}

function formatDateParts(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

function formatTimeParts(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
}

/** PHP format 'F j, Y' -> "January 5, 2026" (transcript date separator). */
export function formatLongDate(value: string, timeZone = "UTC"): string {
  return attempt(value, timeZone, (d, tz) =>
    new Intl.DateTimeFormat(LOCALE, {
      timeZone: tz,
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(d),
  );
}

/**
 * "YYYY-MM-DD" for a timestamp *in the given timezone*.
 *
 * The transcript groups messages under a date separator, so the grouping key must
 * be the calendar day the user actually sees. PHP does the same: it compares
 * `dt($msg['created_at'], 'Y-m-d')`, which is the converted value, not the raw
 * stored UTC date. Using the raw timestamp's date here would put an evening
 * message under the wrong heading for anyone west of UTC.
 */
export function formatDayKey(value: string, timeZone = "UTC"): string {
  if ((value ?? "").trim() === "") return "";
  const d = toUtcDate(value);
  if (d === null) return "";
  const tz = timeZoneOrUndefined(timeZone);
  if (tz === undefined) return "";
  try {
    const parts = new Intl.DateTimeFormat(LOCALE, {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(d);
    const get = (type: Intl.DateTimeFormatPartTypes): string =>
      parts.find((p) => p.type === type)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    return "";
  }
}

/**
 * "Jul 25" for a calendar date such as a daily chart bucket ("2026-07-25").
 *
 * Deliberately ignores the user's timezone. A bucket is a calendar day the
 * database already computed; shifting it through a zone would relabel the day
 * (a UTC-midnight parse rendered west of UTC shows the previous day).
 */
export function formatDayMonth(value: string): string {
  const raw = (value ?? "").trim();
  if (raw === "") return EMPTY_DATETIME;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (match === null) return value;
  const [, y, m, d] = match;
  const utc = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  }).format(utc);
}
