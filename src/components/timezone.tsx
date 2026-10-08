"use client";

import { createContext, useContext, type ReactNode } from "react";
import { formatDate, formatDateTime, formatDayMonth, formatTime } from "@/lib/datetime";

/**
 * The signed-in account's timezone, published to the admin tree so every
 * timestamp renders in the user's preferred zone instead of the browser's.
 *
 * The value comes from `(admin)/layout.tsx`, which reads it off the session (the
 * session carries it because PHP stores it there and refreshes it when the
 * setting changes). Passing it through context keeps it out of every API
 * response and avoids a second round trip per page.
 */
const TimezoneContext = createContext<string>("UTC");

export function TimezoneProvider({ timezone, children }: { timezone: string; children: ReactNode }) {
  return <TimezoneContext.Provider value={timezone}>{children}</TimezoneContext.Provider>;
}

/** The current display timezone; "UTC" outside the admin tree. */
export function useTimezone(): string {
  return useContext(TimezoneContext);
}

/** "Jul 25, 2026 2:30 PM" in the user's timezone. */
export function DateTime({ value }: { value: string }) {
  return <>{formatDateTime(value, useTimezone())}</>;
}

/** "Jul 25, 2026" in the user's timezone. */
export function DateOnly({ value }: { value: string }) {
  return <>{formatDate(value, useTimezone())}</>;
}

/** "2:30 PM" in the user's timezone. */
export function TimeOnly({ value }: { value: string }) {
  return <>{formatTime(value, useTimezone())}</>;
}

/**
 * A calendar-day label (a daily chart bucket, "2026-07-25"): shown as-is, not
 * shifted into the user's timezone, because it names a day the database grouped
 * by rather than a moment in time.
 */
export function DayLabel({ value }: { value: string }) {
  return <>{formatDayMonth(value)}</>;
}
