import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, generateToken, hashRecoveryCode, verifyRecoveryCode } from "@/lib/auth/crypto";

describe("password hashing (Argon2id)", () => {
  it("produces a PHP-compatible argon2id hash (m=65536, t=4, p=1)", async () => {
    const h = await hashPassword("s3cret");
    expect(h).toMatch(/^\$argon2id\$v=19\$m=65536,t=4,p=1\$/);
  });

  it("verifies the correct password and rejects a wrong one", async () => {
    const h = await hashPassword("s3cret");
    expect(await verifyPassword("s3cret", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
  });

  it("produces distinct salts for the same password", async () => {
    const a = await hashPassword("same");
    const b = await hashPassword("same");
    expect(a).not.toBe(b);
  });
});

describe("generateToken", () => {
  it("returns 64 lowercase hex chars by default (32 random bytes)", () => {
    expect(generateToken()).toMatch(/^[0-9a-f]{64}$/);
  });

  it("accepts a custom byte count", () => {
    expect(generateToken(4)).toMatch(/^[0-9a-f]{8}$/);
  });

  it("is unique across calls", () => {
    expect(generateToken()).not.toBe(generateToken());
  });
});

describe("recovery codes (bcrypt)", () => {
  it("round-trips hash/verify", () => {
    const h = hashRecoveryCode("ABC12-9XYZ0");
    expect(verifyRecoveryCode("ABC12-9XYZ0", h)).toBe(true);
    expect(verifyRecoveryCode("WRONG-00000", h)).toBe(false);
  });

  it("produces bcrypt-prefixed hashes (PHP PASSWORD_BCRYPT)", () => {
    expect(hashRecoveryCode("ABCDE-FGHIJ")).toMatch(/^\$2[aby]\$/);
  });
});