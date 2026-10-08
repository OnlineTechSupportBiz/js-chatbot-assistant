import { describe, it, expect, afterEach } from "vitest";
import { encryptSecret, decryptSecret, isSecretEncryptionEnabled } from "@/lib/secret-box";

/**
 * SEC-17, second half: the TOTP seed has to stay readable by the app, so it cannot
 * be hashed — it is encrypted with a key that never enters the database.
 */
const KEY = "test-key-0123456789abcdef0123456789abcdef";

afterEach(() => {
  delete process.env.APP_ENCRYPTION_KEY;
});

describe("secret box (with a key configured)", () => {
  it("round-trips a secret and does not store it verbatim", () => {
    process.env.APP_ENCRYPTION_KEY = KEY;
    expect(isSecretEncryptionEnabled()).toBe(true);

    const secret = "JBSWY3DPEHPK3PXP";
    const stored = encryptSecret(secret);

    expect(stored).not.toBe(secret);
    expect(stored.startsWith("v1:")).toBe(true);
    expect(stored).not.toContain(secret); // not even base64-of-plaintext
    expect(decryptSecret(stored)).toBe(secret);
  });

  it("produces a different ciphertext every time (random IV)", () => {
    process.env.APP_ENCRYPTION_KEY = KEY;
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("rejects a tampered value instead of returning a wrong secret", () => {
    process.env.APP_ENCRYPTION_KEY = KEY;
    const stored = encryptSecret("JBSWY3DPEHPK3PXP");
    const raw = Buffer.from(stored.slice(3), "base64");
    raw[raw.length - 1] ^= 0xff; // flip a bit in the ciphertext
    const tampered = "v1:" + raw.toString("base64");
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("cannot be decrypted with a different key", () => {
    process.env.APP_ENCRYPTION_KEY = KEY;
    const stored = encryptSecret("JBSWY3DPEHPK3PXP");
    process.env.APP_ENCRYPTION_KEY = "a-completely-different-key";
    expect(() => decryptSecret(stored)).toThrow();
  });

  it("passes legacy plaintext through unchanged", () => {
    process.env.APP_ENCRYPTION_KEY = KEY;
    // A seed stored before encryption existed still verifies.
    expect(decryptSecret("PLAINSECRET")).toBe("PLAINSECRET");
  });
});

describe("secret box (no key configured — development fallback)", () => {
  it("stores verbatim and reports encryption as disabled", () => {
    delete process.env.APP_ENCRYPTION_KEY;
    expect(isSecretEncryptionEnabled()).toBe(false);
    expect(encryptSecret("PLAINSECRET")).toBe("PLAINSECRET");
    expect(decryptSecret("PLAINSECRET")).toBe("PLAINSECRET");
  });

  it("refuses to read an encrypted value rather than returning garbage", () => {
    delete process.env.APP_ENCRYPTION_KEY;
    expect(() => decryptSecret("v1:AAAA")).toThrow(/APP_ENCRYPTION_KEY/);
  });
});
