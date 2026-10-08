import { describe, it, expect } from "vitest";
import { generateTotpSecret, generateTotpToken, verifyTotp, generateRecoveryCodes } from "@/lib/auth/totp";

describe("TOTP", () => {
  it("generates a base32 secret and a valid 6-digit token", () => {
    const secret = generateTotpSecret();
    expect(secret.length).toBeGreaterThanOrEqual(16);
    const token = generateTotpToken(secret);
    expect(token).toMatch(/^\d{6}$/);
  });

  it("verifies the correct token and rejects a wrong one", () => {
    const secret = generateTotpSecret();
    const token = generateTotpToken(secret);
    expect(verifyTotp(secret, token)).toBe(true);
    expect(verifyTotp(secret, "000000")).toBe(false);
  });

  it("accepts a ±1 drift window", () => {
    const secret = generateTotpSecret();
    const token = generateTotpToken(secret);
    expect(verifyTotp(secret, token, 1)).toBe(true);
  });
});

describe("recovery codes", () => {
  it("generates 10 unique XXXXX-XXXXX uppercase-hex codes", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    for (const c of codes) {
      expect(c).toMatch(/^[0-9A-F]{5}-[0-9A-F]{5}$/);
    }
    expect(new Set(codes).size).toBe(10);
  });

  it("honors a custom count", () => {
    expect(generateRecoveryCodes(4)).toHaveLength(4);
  });
});