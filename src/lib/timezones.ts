/**
 * Timezone options for the settings dropdown, and validation of what the API
 * accepts.
 *
 * Each option carries the IANA name as its `value` (what is stored, and what
 * `Intl` consumes) plus a human-readable `label` for display, so the list reads
 * "US Mountain (Denver)" rather than "America/Denver".
 *
 * Two layers:
 *   1. `CURATED_LABELS` — copied verbatim from PHP
 *      `App\Util\DateTimeHelper::TIMEZONES`, in the same order. Same wording, so
 *      the two backends present an identical dropdown.
 *   2. Every other zone the runtime knows (~380 more IANA names) gets a
 *      generated label in the same "Region (City)" shape, so the full list is
 *      usable without hand-maintaining each entry.
 *
 * The source list is the runtime's own ICU data (`Intl.supportedValuesOf`), so
 * this needs no dependency. Two details matter:
 *
 *   - `supportedValuesOf("timeZone")` does NOT include "UTC", but "UTC" is the
 *     schema default (`users.timezone DEFAULT 'UTC'`), so it is added back.
 *   - The list is generated on the SERVER and shipped in the settings API
 *     response. Generating it in the browser would risk a hydration mismatch,
 *     because browser and server ICU versions can differ.
 */

/** PHP `DateTimeHelper::TIMEZONES`, verbatim and in order. */
export const CURATED_LABELS: Record<string, string> = {
  UTC: "UTC (Coordinated Universal Time)",
  "America/New_York": "US Eastern (New York)",
  "America/Chicago": "US Central (Chicago)",
  "America/Denver": "US Mountain (Denver)",
  "America/Phoenix": "US Mountain (Phoenix — no DST)",
  "America/Los_Angeles": "US Pacific (Los Angeles)",
  "America/Anchorage": "US Alaska (Anchorage)",
  "Pacific/Honolulu": "US Hawaii (Honolulu)",
  "America/Argentina/Buenos_Aires": "Argentina (Buenos Aires)",
  "America/Sao_Paulo": "Brasil (São Paulo)",
  "America/Mexico_City": "Mexico (Mexico City)",
  "America/Toronto": "Canada Eastern (Toronto)",
  "America/Vancouver": "Canada Pacific (Vancouver)",
  "Europe/London": "United Kingdom (London)",
  "Europe/Paris": "Central Europe (Paris/Berlin)",
  "Europe/Athens": "Eastern Europe (Athens/Helsinki)",
  "Europe/Moscow": "Moscow",
  "Europe/Istanbul": "Turkey (Istanbul)",
  "Asia/Dubai": "Gulf (Dubai)",
  "Asia/Kolkata": "India (Kolkata)",
  "Asia/Dhaka": "Bangladesh (Dhaka)",
  "Asia/Bangkok": "Indochina (Bangkok/Jakarta)",
  "Asia/Shanghai": "China (Shanghai)",
  "Asia/Singapore": "Singapore",
  "Asia/Tokyo": "Japan (Tokyo)",
  "Asia/Seoul": "Korea (Seoul)",
  "Australia/Sydney": "Australia Eastern (Sydney)",
  "Australia/Adelaide": "Australia Central (Adelaide)",
  "Australia/Perth": "Australia Western (Perth)",
  "Pacific/Auckland": "New Zealand (Auckland)",
  "Pacific/Fiji": "Fiji",
  "Africa/Cairo": "Egypt (Cairo)",
  "Africa/Johannesburg": "South Africa (Johannesburg)",
  "Africa/Lagos": "West Africa (Lagos)",
  "Africa/Nairobi": "East Africa (Nairobi)",
};

/** Friendlier wording for the leading segment of a generated label. */
const REGION_NAMES: Record<string, string> = {
  Africa: "Africa",
  America: "Americas",
  Antarctica: "Antarctica",
  Arctic: "Arctic",
  Asia: "Asia",
  Atlantic: "Atlantic",
  Australia: "Australia",
  Europe: "Europe",
  Indian: "Indian Ocean",
  Pacific: "Pacific",
  Etc: "UTC offsets",
};

/**
 * Long-tail labels in PHP's "Region (City)" shape:
 *   "Africa/Abidjan"        -> "Africa (Abidjan)"
 *   "America/Indiana/Knox"  -> "Indiana (Knox)"
 *   "Atlantic/Reykjavik"    -> "Atlantic (Reykjavik)"
 *
 * Curated zones never reach this: they are taken from CURATED_LABELS.
 */
function generateLabel(id: string): string {
  const segments = id.split("/").filter((s) => s !== "");
  const readable = (s: string): string => s.replace(/_/g, " ");
  if (segments.length === 0) return id;
  if (segments.length === 1) return REGION_NAMES[segments[0]] ?? readable(segments[0]);

  const city = readable(segments[segments.length - 1]);
  // With three segments the middle one is the human-meaningful region
  // (America/Indiana/Knox, America/Argentina/Buenos_Aires).
  const regionKey = segments.length >= 3 ? segments[1] : segments[0];
  const region = REGION_NAMES[regionKey] ?? readable(regionKey);
  return `${region} (${city})`;
}

/** True when the runtime's ICU knows this zone. */
function isKnownZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export interface TimezoneOption {
  /** IANA name — what is stored and what `Intl` consumes. */
  value: string;
  /** Human-readable label shown in the dropdown. */
  label: string;
}

/**
 * Every selectable zone: the curated, human-named ones first in PHP's order,
 * then the remaining IANA zones alphabetically with generated labels. A curated
 * entry the runtime does not recognise is dropped rather than offered, so the
 * dropdown can never send a zone the API would reject.
 */
export function listTimezoneOptions(): TimezoneOption[] {
  const supported =
    typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  // Seed with the curated ids too. `supportedValuesOf` is not exhaustive: it
  // lists "America/Buenos_Aires" while PHP (and tzdata) use the canonical
  // "America/Argentina/Buenos_Aires", which Intl itself accepts happily.
  const remaining = new Set([...supported, ...Object.keys(CURATED_LABELS), "UTC"].filter(isKnownZone));

  const curated: TimezoneOption[] = [];
  for (const [value, label] of Object.entries(CURATED_LABELS)) {
    if (remaining.delete(value)) curated.push({ value, label });
  }

  const rest: TimezoneOption[] = [...remaining]
    .sort((a, b) => a.localeCompare(b))
    .map((value) => ({ value, label: generateLabel(value) }));

  return [...curated, ...rest];
}

/** Just the IANA names, in dropdown order. */
export function listTimezones(): string[] {
  return listTimezoneOptions().map((o) => o.value);
}

/**
 * Validate a timezone submitted by the settings form.
 *
 * Checks it is a real zone the runtime understands rather than only that it is in
 * the option list, so legacy aliases ICU still accepts (e.g. "US/Mountain") are
 * allowed through and existing rows keep working.
 *
 * Returns an error message, or null when the value is acceptable.
 */
export function validateTimezone(value: string): string | null {
  const tz = value.trim();
  if (tz === "") return "Timezone is required.";
  // users.timezone is VARCHAR(64).
  if (tz.length > 64) return "Timezone is too long.";
  if (!isKnownZone(tz)) return `Unknown timezone: ${tz}`;
  return null;
}
