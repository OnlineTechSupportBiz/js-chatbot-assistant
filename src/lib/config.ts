import { z } from "zod";

/**
 * Typed, validated environment configuration.
 *
 * Mirrors the PHP `config/config.php` + `EmailService` env surface, with the
 * EmailService (587/STARTTLS) mail defaults, since that is the code path that
 * actually sends mail in the PHP app — config.php's 465/ssl default is dead.
 *
 * Two-role DB model (REQUIRED): the app connects as `DB_USER` (subject to RLS);
 * migrations run as the separate `DB_MIGRATOR_USER` owner role, so the app role
 * does NOT own the tables and RLS genuinely enforces. There is no single-role
 * mode — assertRlsConfiguration() refuses to start without it.
 */

const EnvSchema = z.object({
  APP_ENV: z.string().default("production"),
  APP_URL: z.string().default("http://localhost:8000"),

  // Platform-wide registration gate. This used to be the `registration_enabled`
  // row in `platform_settings`, shown as a checkbox on every account's Settings
  // page. That table has no RLS, so the setting was a single global value that
  // ANY admin could overwrite, with no account owning it. It now lives here,
  // where the operator who deploys the app owns it. Strict enum so a typo fails
  // at boot instead of silently leaving registration open or closed.
  ALLOW_REGISTRATION: z
    .enum(["true", "false", "1", "0"])
    .default("true")
    .transform((v) => v === "true" || v === "1"),

  SESSION_COOKIE_NAME: z.string().default("chatbot_session"),
  SESSION_LIFETIME: z.coerce.number().int().positive().default(1440),

  DB_HOST: z.string().default("127.0.0.1"),
  DB_PORT: z.coerce.number().int().positive().default(5432),
  DB_SCHEMA: z.string().default("chatbot_schema"),
  DB_NAME: z.string().default("chatbot_assistant"),
  DB_USER: z.string().default("chatbot_user"),
  DB_PASS: z.string().default(""),
  // Optional owner role for migrations. Empty => single-role mode (PHP parity).
  DB_MIGRATOR_USER: z.string().default(""),
  DB_MIGRATOR_PASS: z.string().default(""),

  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_AUTH: z
    .string()
    .default("true")
    .transform((v) => v === "true"),
  SMTP_USER: z.string().default(""),
  SMTP_PASS: z.string().default(""),
  SMTP_ENCRYPTION: z.string().default("starttls"),
  MAIL_FROM_ADDRESS: z.string().default("noreply@onlinetechsupport.biz"),
  MAIL_FROM_NAME: z.string().default("Chatbot Assistant"),
  STORAGE_DIR: z.string().default("storage/uploads"),

  // Number of reverse proxies in front of the app whose X-Forwarded-For entries
  // are trustworthy. 0 (the default) means the app is exposed directly, so proxy
  // headers are ignored completely; set 1 behind a single nginx/Caddy/Traefik hop.
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),

  // Abuse ceiling for the unauthenticated widget chat endpoint, per IP and per
  // widget token per window. These key on values the caller cannot choose — the
  // network address and the chatbot's own token — so they are what actually stops a
  // script. They protect the instance and the tenant's API bill. The per-chatbot
  // `rate_limit_per_session` is keyed on a client-supplied session id and therefore
  // cannot bound spend on its own. Tenants can TIGHTEN these per chatbot
  // (`rate_limit_per_ip` / `rate_limit_per_token`), never raise them.
  // 120/min per IP is aimed at busy public sites; the token ceiling is per chatbot,
  // across all its visitors.
  PUBLIC_CHAT_RATE_MAX: z.coerce.number().int().positive().default(120),
  PUBLIC_CHAT_TOKEN_RATE_MAX: z.coerce.number().int().positive().default(300),
  PUBLIC_CHAT_RATE_WINDOW: z.coerce.number().int().positive().default(60),

  // Provider base URLs (llm_base_url / embedding_base_url / per-model base_url) are
  // fetched server-side. By default they must point at a public host, so a tenant
  // cannot aim the app at loopback, RFC1918 or cloud-metadata addresses. Operators
  // running a self-hosted OpenAI-compatible server (Ollama, LM Studio, vLLM) turn
  // this on — it is an operator decision, never a tenant one.
  ALLOW_PRIVATE_PROVIDER_URLS: z
    .enum(["true", "false", "1", "0"])
    .default("false")
    .transform((v) => v === "true" || v === "1"),

  // Key for encrypting secrets that must stay readable to the app (the TOTP seed).
  // Any length is accepted (it is hashed to 32 bytes); generate with
  // `openssl rand -hex 32`. Production refuses to start without it, because the
  // alternative is storing second-factor seeds in the clear (SEC-17).
  APP_ENCRYPTION_KEY: z.string().default(""),
});

export interface DbConfig {
  host: string;
  port: number;
  schema: string;
  name: string;
  user: string;
  pass: string;
  migratorUser: string;
  migratorPass: string;
}

export interface MailConfig {
  host: string;
  port: number;
  auth: boolean;
  user: string;
  pass: string;
  encryption: string;
  fromAddress: string;
  fromName: string;
}

export interface AppConfig {
  env: string;
  url: string;
  /** Whether the public register page and endpoint accept new accounts. */
  allowRegistration: boolean;
  session: { cookieName: string; lifetime: number };
  db: DbConfig;
  mail: MailConfig;
  storageDir: string;
  /** Trusted reverse-proxy hops for X-Forwarded-For (0 = trust nothing). */
  trustedProxyHops: number;
  publicChatRate: { maxPerIp: number; maxPerToken: number; windowSeconds: number };
  /** Permit provider URLs that resolve to private/loopback hosts (self-hosted LLMs). */
  allowPrivateProviderUrls: boolean;
  /** Key for reversible encryption of stored secrets (the TOTP seed). */
  appEncryptionKey: string;
}

export interface DbCredentials {
  user: string;
  pass: string;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = EnvSchema.parse(env);
  return {
    env: parsed.APP_ENV,
    url: parsed.APP_URL,
    allowRegistration: parsed.ALLOW_REGISTRATION,
    session: {
      cookieName: parsed.SESSION_COOKIE_NAME,
      lifetime: parsed.SESSION_LIFETIME,
    },
    db: {
      host: parsed.DB_HOST,
      port: parsed.DB_PORT,
      schema: parsed.DB_SCHEMA,
      name: parsed.DB_NAME,
      user: parsed.DB_USER,
      pass: parsed.DB_PASS,
      migratorUser: parsed.DB_MIGRATOR_USER,
      migratorPass: parsed.DB_MIGRATOR_PASS,
    },
    mail: {
      host: parsed.SMTP_HOST,
      port: parsed.SMTP_PORT,
      auth: parsed.SMTP_AUTH,
      user: parsed.SMTP_USER,
      pass: parsed.SMTP_PASS,
      encryption: parsed.SMTP_ENCRYPTION,
      fromAddress: parsed.MAIL_FROM_ADDRESS,
      fromName: parsed.MAIL_FROM_NAME,
    },
    storageDir: parsed.STORAGE_DIR,
    trustedProxyHops: parsed.TRUSTED_PROXY_HOPS,
    publicChatRate: {
      maxPerIp: parsed.PUBLIC_CHAT_RATE_MAX,
      maxPerToken: parsed.PUBLIC_CHAT_TOKEN_RATE_MAX,
      windowSeconds: parsed.PUBLIC_CHAT_RATE_WINDOW,
    },
    allowPrivateProviderUrls: parsed.ALLOW_PRIVATE_PROVIDER_URLS,
    appEncryptionKey: parsed.APP_ENCRYPTION_KEY,
  };
}

/**
 * Refuse to run a production deployment whose tenant isolation is inert.
 *
 * RLS only isolates tenants when the app role does **not** own the tables. With
 * `DB_MIGRATOR_USER` empty, migrations run as the app role, it owns every table,
 * and PostgreSQL exempts owners from their own policies — so every repository
 * query that filters only by id silently reaches other tenants. There is no
 * opt-out: the two-role split is required in every environment.
 */
export function assertRlsConfiguration(config: AppConfig = getConfig()): void {
  const singleRole = config.db.migratorUser === "" || config.db.migratorUser === config.db.user;
  if (singleRole) {
    throw new Error(
      "Refusing to start: DB_MIGRATOR_USER must be a separate role from DB_USER. " +
        "The application role must not own the database tables, or PostgreSQL " +
        "Row-Level Security cannot isolate tenants. There is no single-role mode.",
    );
  }
}

/**
 * Refuse to run a production deployment that would store second-factor seeds in
 * the clear.
 *
 * A TOTP seed is a bearer credential: anyone who can read `users.mfa_secret` can
 * generate valid codes forever, which defeats the second factor entirely. The
 * seed has to stay recoverable (unlike a password), so it is encrypted rather
 * than hashed — and that needs a key. Without `APP_ENCRYPTION_KEY` the app falls
 * back to storing it verbatim, which is acceptable on a laptop and not in
 * production.
 */
export function assertSecretEncryptionConfiguration(config: AppConfig = getConfig()): void {
  if (config.appEncryptionKey === "" && config.env === "production") {
    throw new Error(
      "Refusing to start: APP_ENCRYPTION_KEY is unset, so multi-factor authentication " +
        "seeds would be stored unencrypted. Generate one with `openssl rand -hex 32` " +
        "and set APP_ENCRYPTION_KEY (changing it later invalidates existing MFA " +
        "enrollments).",
    );
  }
}

/**
 * Resolve credentials for a role. The `migrator` role uses `DB_MIGRATOR_*` when
 * set, else falls back to the app role (single-role mode).
 */
export function getDbCredentials(db: DbConfig, role: "app" | "migrator"): DbCredentials {
  if (role === "migrator" && db.migratorUser !== "") {
    return { user: db.migratorUser, pass: db.migratorPass };
  }
  return { user: db.user, pass: db.pass };
}

let cached: AppConfig | null = null;

/** Cached per-process config (Next.js loads .env into process.env automatically). */
export function getConfig(): AppConfig {
  if (cached === null) {
    cached = loadConfig();
  }
  return cached;
}