import { generateSecret, generateSync, verifySync } from "otplib";
import { randomBytes } from "node:crypto";

/**
 * TOTP (MFA) + recovery codes, matching PHP `OTPHP\TOTP` defaults:
 * SHA-1, 6 digits, 30s period. Enrollment verifies with a 0-step window,
 * challenge with a ±1-step window (clock drift).
 *
 * Recovery codes use the `XXXXX-XXXXX` uppercase-hex format (two 5-char halves
 * from random_bytes(4) each, joined with `-`) and are bcrypt-hashed for storage.
 */

/** Generate a base32 TOTP secret (used with 6-digit, 30s, SHA-1 — OTPHP defaults). */
export function generateTotpSecret(): string {
  return generateSecret();
}

/** Generate the current TOTP token for a secret (used for tests/QR preview). */
export function generateTotpToken(secret: string): string {
  return generateSync({ secret });
}

/**
 * Verify a TOTP token. `windowSteps` is the number of ±30s periods to allow
 * (0 for enrollment, 1 for challenge clock-drift tolerance). otplib v13 takes
 * tolerance in seconds via `epochTolerance`.
 */
export function verifyTotp(secret: string, token: string, windowSteps = 0): boolean {
  try {
    const result = verifySync({ token, secret, epochTolerance: windowSteps * 30 });
    return result.valid === true;
  } catch {
    return false; // invalid/empty secret must not throw
  }
}

/** Generate `count` recovery codes in `XXXXX-XXXXX` uppercase-hex format (unique). */
export function generateRecoveryCodes(count = 10): string[] {
  const codes: string[] = [];
  const seen = new Set<string>();
  while (codes.length < count) {
    const a = randomBytes(4).toString("hex").slice(0, 5).toUpperCase();
    const b = randomBytes(4).toString("hex").slice(0, 5).toUpperCase();
    const code = `${a}-${b}`;
    if (!seen.has(code)) {
      seen.add(code);
      codes.push(code);
    }
  }
  return codes;
}