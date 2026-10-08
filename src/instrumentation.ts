/**
 * Runs once when the Next.js server process starts, before it serves anything.
 *
 * Validating configuration here (rather than lazily on the first database use)
 * means a production deployment fails immediately with a clear message, instead
 * of quietly serving cross-tenant data or storing credentials in the clear:
 *
 *  - the database cannot isolate tenants (SEC-01) — the two-role DB model is
 *    required, there is no opt-out
 *  - `APP_ENCRYPTION_KEY` is unset, so MFA seeds would be stored unencrypted
 *    (SEC-17)
 */
export async function register(): Promise<void> {
  const { loadConfig, assertRlsConfiguration, assertSecretEncryptionConfiguration } = await import(
    "@/lib/config"
  );
  const config = loadConfig();
  assertRlsConfiguration(config);
  assertSecretEncryptionConfiguration(config);
}
