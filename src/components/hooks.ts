"use client";

import { useEffect, useState, useCallback } from "react";

/** Fetches the per-session CSRF token once, for use in admin form submissions. */
export function useCsrf(): string {
  const [csrf, setCsrf] = useState("");
  useEffect(() => {
    fetch("/csrf")
      .then((r) => r.json())
      .then((d) => setCsrf(d.csrf ?? ""))
      .catch(() => {});
  }, []);
  return csrf;
}

export interface FetchState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  refresh: () => void;
}

/** Authenticated GET against an admin JSON endpoint, with a manual refresh fn. */
export function useFetch<T>(url: string): FetchState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(url)
      .then(async (r) => {
        const body = await r.json().catch(() => null);
        if (!r.ok) throw new Error((body as { error?: string } | null)?.error ?? `Request failed (${r.status})`);
        return body as T;
      })
      .then((d) => {
        if (active) {
          setData(d);
          setError(null);
        }
      })
      .catch((e: Error) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [url, tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, refresh };
}