import { describe, it, expect } from "vitest";
import {
  EMPTY_DATETIME,
  formatDate,
  formatDateTime,
  formatDayKey,
  formatDayMonth,
  formatIso,
  formatLongDate,
  formatTime,
} from "@/lib/datetime";

/**
 * Ports PHP `tests/Unit/DateTimeHelperTest.php` — the authoritative expectations
 * for this helper. The reference value used throughout is
 * '2026-07-25 14:30:00', which PHP treats as UTC.
 */
const TS = "2026-07-25 14:30:00";

describe("formatDateTime", () => {
  it("formats a UTC timestamp (PHP format 'M j, Y g:i A')", () => {
    expect(formatDateTime(TS, "UTC")).toBe("Jul 25, 2026 2:30 PM");
  });

  it("converts to the user's timezone", () => {
    // 14:30 UTC = 10:30 EDT in July
    expect(formatDateTime(TS, "America/New_York")).toBe("Jul 25, 2026 10:30 AM");
    // 14:30 UTC = 07:30 PDT
    expect(formatDateTime(TS, "America/Los_Angeles")).toBe("Jul 25, 2026 7:30 AM");
    // Same instant, opposite side of the date line: 23:00 UTC is the 26th in Tokyo.
    expect(formatDateTime("2026-07-25 23:00:00", "Asia/Tokyo")).toBe("Jul 26, 2026 8:00 AM");
  });

  it("handles the DST boundary like PHP", () => {
    // 07:00 UTC on 2026-03-08 = 03:00 EDT (UTC-4)
    expect(formatIso("2026-03-08 07:00:00", "America/New_York")).toBe("2026-03-08 03:00");
  });

  it("renders midnight and noon in 12-hour form", () => {
    expect(formatDateTime("2026-07-25 00:00:00", "UTC")).toContain("12:00 AM");
    expect(formatDateTime("2026-07-25 12:00:00", "UTC")).toContain("12:00 PM");
  });

  it("falls back to the raw value instead of throwing", () => {
    expect(formatDateTime("not-a-date", "UTC")).toBe("not-a-date");
    expect(formatDateTime(TS, "Not/A/Timezone")).toBe(TS);
  });

  it("renders an em dash for an empty value", () => {
    expect(formatDateTime("", "UTC")).toBe(EMPTY_DATETIME);
    expect(formatDateTime("   ", "UTC")).toBe(EMPTY_DATETIME);
  });

  it("treats a zone-less stored timestamp as UTC, like PHP", () => {
    // The API sends an explicit instant ("...Z"); a naive string is the DB's raw
    // shape and PHP reads it with an explicit UTC zone. Must not be read as local.
    expect(formatDateTime(TS, "UTC")).toBe(formatDateTime("2026-07-25T14:30:00Z", "UTC"));
    expect(formatDateTime(TS, "UTC")).toBe(formatDateTime("2026-07-25T14:30:00.000Z", "UTC"));
  });
});

describe("formatDate / formatTime / formatIso", () => {
  it("formats a date only (PHP 'M j, Y')", () => {
    expect(formatDate(TS, "UTC")).toBe("Jul 25, 2026");
    expect(formatDate("2026-07-25 23:00:00", "Asia/Tokyo")).toBe("Jul 26, 2026");
  });

  it("formats a time only (PHP 'g:i A')", () => {
    expect(formatTime(TS, "UTC")).toBe("2:30 PM");
  });

  it("formats an ISO-ish string (PHP 'Y-m-d H:i')", () => {
    expect(formatIso(TS, "UTC")).toBe("2026-07-25 14:30");
    // 14:30 UTC = 10:30 EDT
    expect(formatIso(TS, "America/New_York")).toBe("2026-07-25 10:30");
    expect(formatIso("2026-07-25 00:30:00", "UTC")).toBe("2026-07-25 00:30");
  });
});

describe("formatLongDate", () => {
  it("formats a UTC timestamp (PHP format 'F j, Y')", () => {
    expect(formatLongDate(TS, "UTC")).toBe("July 25, 2026");
    expect(formatLongDate("2026-01-05 09:00:00", "UTC")).toBe("January 5, 2026");
  });

  it("converts to the user's timezone", () => {
    expect(formatLongDate("2026-07-25 23:00:00", "Asia/Tokyo")).toBe("July 26, 2026");
    expect(formatLongDate("2026-07-25 02:00:00", "America/Los_Angeles")).toBe("July 24, 2026");
  });

  it("renders an empty value as an em dash", () => {
    expect(formatLongDate("", "UTC")).toBe(EMPTY_DATETIME);
  });
});

describe("formatDayKey", () => {
  it("names the calendar day the user sees, not the raw stored date", () => {
    expect(formatDayKey(TS, "UTC")).toBe("2026-07-25");
    // 14:30 UTC = 10:30 EDT — still the 25th.
    expect(formatDayKey(TS, "America/New_York")).toBe("2026-07-25");
    // 23:00 UTC is already the 26th in Tokyo: the transcript must group it there.
    expect(formatDayKey("2026-07-25 23:00:00", "Asia/Tokyo")).toBe("2026-07-26");
    // 02:00 UTC is still the 24th in Los Angeles.
    expect(formatDayKey("2026-07-25 02:00:00", "America/Los_Angeles")).toBe("2026-07-24");
  });

  it("returns an empty key for unusable input so the caller skips the separator", () => {
    expect(formatDayKey("", "UTC")).toBe("");
    expect(formatDayKey("nonsense", "UTC")).toBe("");
    expect(formatDayKey(TS, "Not/AZone")).toBe("");
  });
});

describe("formatDayMonth", () => {
  it("labels a daily bucket as the day the database grouped by", () => {
    // Deliberately NOT shifted into the user's timezone: a UTC-midnight parse
    // rendered west of UTC would show the previous day.
    expect(formatDayMonth("2026-07-25")).toBe("Jul 25");
    expect(formatDayMonth("2026-01-01")).toBe("Jan 1");
  });

  it("passes through non-date input unchanged", () => {
    expect(formatDayMonth("nonsense")).toBe("nonsense");
    expect(formatDayMonth("")).toBe(EMPTY_DATETIME);
  });
});
