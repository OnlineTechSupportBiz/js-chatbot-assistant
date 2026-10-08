import { describe, it, expect } from "vitest";
import { effectiveRateLimits, type OperatorRateLimits } from "@/lib/chatbot/limits";

/**
 * The rule these tests pin down: a tenant configures their own chatbot's anti-abuse
 * limits, and the effective limit is always the LOWER of theirs and the server
 * ceiling. Tightening is a tenant decision; widening is not.
 */

const OPERATOR: OperatorRateLimits = { maxPerIp: 120, maxPerToken: 300, windowSeconds: 60 };
const NO_TENANT_LIMITS = { rate_limit_per_ip: null, rate_limit_per_token: null };

describe("effectiveRateLimits", () => {
  it("uses the server ceilings when the tenant set nothing", () => {
    const r = effectiveRateLimits(OPERATOR, NO_TENANT_LIMITS, false);
    expect(r).toEqual({ ipMax: 120, tokenMax: 300, windowSeconds: 60 });
  });

  it("lets a tenant tighten a ceiling", () => {
    const r = effectiveRateLimits(
      OPERATOR,
      { rate_limit_per_ip: 10, rate_limit_per_token: 50 },
      false,
    );
    expect(r.ipMax).toBe(10);
    expect(r.tokenMax).toBe(50);
  });

  it("ignores a tenant value above the ceiling — a tenant cannot widen protection", () => {
    const r = effectiveRateLimits(
      OPERATOR,
      { rate_limit_per_ip: 9999, rate_limit_per_token: 9999 },
      false,
    );
    expect(r.ipMax).toBe(120);
    expect(r.tokenMax).toBe(300);
  });

  it("treats 0, negative and non-numeric values as 'no opinion'", () => {
    for (const bad of [0, -5, Number.NaN]) {
      const r = effectiveRateLimits(
        OPERATOR,
        { rate_limit_per_ip: bad, rate_limit_per_token: bad },
        false,
      );
      expect(r.ipMax).toBe(120);
      expect(r.tokenMax).toBe(300);
    }
  });

  it("keeps the untrusted-address allowance, but a tenant limit still applies on top", () => {
    // When the caller's address cannot be trusted the server raises its per-IP
    // allowance 10× so one shared bucket cannot lock every visitor out...
    expect(effectiveRateLimits(OPERATOR, NO_TENANT_LIMITS, true).ipMax).toBe(1200);
    // ...and a tenant's own (stricter) limit is honoured regardless.
    expect(
      effectiveRateLimits(OPERATOR, { rate_limit_per_ip: 40, rate_limit_per_token: null }, true).ipMax,
    ).toBe(40);
  });

  it("leaves the per-chatbot ceiling alone when only the IP limit was set", () => {
    const r = effectiveRateLimits(OPERATOR, { rate_limit_per_ip: 15, rate_limit_per_token: null }, false);
    expect(r).toEqual({ ipMax: 15, tokenMax: 300, windowSeconds: 60 });
  });
});
