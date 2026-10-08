import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Reversible encryption for the one secret the app has to be able to *read back*:
 * the TOTP seed behind multi-factor authentication (SEC-17).
 *
 * Hashing is the right answer for every other credential (session ids, reset
 * links, magic links, recovery codes) because nothing ever needs to read them —
 * only compare. A TOTP seed is different: the server must recompute codes from it
 * on every challenge, so it cannot be hashed. It can still be kept out of reach of
 * a database read, which is what this does: AES-256-GCM with a key that lives in
 * `APP_ENCRYPTION_KEY` (never in the database), so a leaked dump or a read-only
 * SQL injection yields ciphertext.
 *
 * Format: `v1:` + base64(iv | authTag | ciphertext). Anything without that prefix
 * is returned as-is, so a seed stored before this existed keeps working and is
 * upgraded the next time it is written. GCM's auth tag means a tampered value
 * fails to decrypt instead of silently producing a wrong seed.
 */

const PREFIX = "v1:";
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Derive the 32-byte key. Any input length is accepted (`openssl rand -hex 32`). */
function encryptionKey(): Buffer | null {
  // Read the environment directly rather than through getConfig(): that accessor
  // caches the whole config per process, and a key that is read (and tested) as a
  // live value is worth more than the one-line convenience. `loadConfig()` still
  // carries the same value, which is what the production assertion checks.
  const raw = process.env.APP_ENCRYPTION_KEY ?? "";
  if (raw === "") return null;
  return createHash("sha256").update(raw, "utf8").digest();
}

/** True when a key is configured, i.e. new secrets will be encrypted. */
export function isSecretEncryptionEnabled(): boolean {
  return encryptionKey() !== null;
}

/**
 * Encrypt a secret for storage. Without a configured key the value is returned
 * unchanged — the development fallback, which production refuses to run on
 * (`assertSecretEncryptionConfiguration`).
 */
export function encryptSecret(plaintext: string): string {
  const key = encryptionKey();
  if (key === null) return plaintext;

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}

/**
 * Decrypt a stored secret. Values without the `v1:` prefix are legacy plaintext
 * (or were written while no key was configured) and pass through unchanged, so
 * existing MFA enrollments keep working across this change.
 */
export function decryptSecret(stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored;

  const key = encryptionKey();
  if (key === null) {
    throw new Error(
      "APP_ENCRYPTION_KEY is required to read an encrypted secret (set it to the key " +
        "that was configured when the secret was stored)",
    );
  }

  const payload = Buffer.from(stored.slice(PREFIX.length), "base64");
  if (payload.length < IV_BYTES + TAG_BYTES) {
    throw new Error("Encrypted secret is truncated");
  }
  const iv = payload.subarray(0, IV_BYTES);
  const tag = payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = payload.subarray(IV_BYTES + TAG_BYTES);

  // authTagLength pins the expected tag to 16 bytes, so a truncated tag cannot be
  // substituted: Node would otherwise accept a shorter tag and forgery gets easier.
  // Final() throws on a failed tag check — never swallow that and return plaintext.
  const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
