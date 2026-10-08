import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig, getDbCredentials } from "@/lib/config";

const ENV_KEYS = /^(APP|DB|SESSION|SMTP|MAIL)_|^ALLOW_REGISTRATION$/;

describe("loadConfig", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const key of Object.keys(process.env)) {
      if (ENV_KEYS.test(key)) {
        saved[key] = process.env[key];
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (ENV_KEYS.test(key)) delete process.env[key];
    }
    Object.assign(process.env, saved);
  });

  it("applies the .env.example defaults when nothing is set", () => {
    const c = loadConfig({});
    expect(c.env).toBe("production");
    expect(c.url).toBe("http://localhost:8000");
    expect(c.session).toEqual({ cookieName: "chatbot_session", lifetime: 1440 });
    expect(c.db).toEqual({
      host: "127.0.0.1",
      port: 5432,
      schema: "chatbot_schema",
      name: "chatbot_assistant",
      user: "chatbot_user",
      pass: "",
      migratorUser: "",
      migratorPass: "",
    });
    // Mail defaults mirror the PHP EmailService (587/STARTTLS), not config.php (465/ssl).
    expect(c.mail.port).toBe(587);
    expect(c.mail.encryption).toBe("starttls");
    expect(c.mail.auth).toBe(true);
  });

  it("reads overrides from the environment", () => {
    const c = loadConfig({
      DB_PORT: "5433",
      APP_URL: "https://chat.example.com",
      SMTP_PORT: "465",
      SMTP_ENCRYPTION: "ssl",
      SMTP_AUTH: "false",
    });
    expect(c.db.port).toBe(5433);
    expect(c.url).toBe("https://chat.example.com");
    expect(c.mail.port).toBe(465);
    expect(c.mail.encryption).toBe("ssl");
    expect(c.mail.auth).toBe(false);
  });

  it("coerces numeric strings", () => {
    const c = loadConfig({ SESSION_LIFETIME: "30", DB_PORT: "5432" });
    expect(c.session.lifetime).toBe(30);
    expect(c.db.port).toBe(5432);
  });

  it("rejects an invalid port", () => {
    expect(() => loadConfig({ DB_PORT: "not-a-number" })).toThrow();
  });
});

describe("ALLOW_REGISTRATION", () => {
  it("defaults to open", () => {
    expect(loadConfig({}).allowRegistration).toBe(true);
  });

  it("accepts true/1 and false/0", () => {
    expect(loadConfig({ ALLOW_REGISTRATION: "true" }).allowRegistration).toBe(true);
    expect(loadConfig({ ALLOW_REGISTRATION: "1" }).allowRegistration).toBe(true);
    expect(loadConfig({ ALLOW_REGISTRATION: "false" }).allowRegistration).toBe(false);
    expect(loadConfig({ ALLOW_REGISTRATION: "0" }).allowRegistration).toBe(false);
  });

  it("fails at boot on a typo instead of silently choosing a value", () => {
    // A loose parse would read "no"/"off"/"yah" as truthy and leave sign-ups
    // open when the operator meant to close them.
    for (const bad of ["no", "off", "yes", "TRUE", "2", ""]) {
      expect(() => loadConfig({ ALLOW_REGISTRATION: bad })).toThrow();
    }
  });
});

describe("getDbCredentials", () => {
  it("defaults the migrator role to empty (single-role mode)", () => {
    const c = loadConfig({});
    expect(c.db.migratorUser).toBe("");
    expect(c.db.migratorPass).toBe("");
  });

  it("app role always uses DB_USER/DB_PASS", () => {
    const c = loadConfig({ DB_USER: "app", DB_PASS: "p", DB_MIGRATOR_USER: "owner" });
    expect(getDbCredentials(c.db, "app")).toEqual({ user: "app", pass: "p" });
  });

  it("migrator role uses DB_MIGRATOR_* when set", () => {
    const c = loadConfig({ DB_USER: "app", DB_MIGRATOR_USER: "owner", DB_MIGRATOR_PASS: "op" });
    expect(getDbCredentials(c.db, "migrator")).toEqual({ user: "owner", pass: "op" });
  });

  it("migrator role falls back to DB_USER when DB_MIGRATOR_USER is empty", () => {
    const c = loadConfig({ DB_USER: "app", DB_PASS: "p" });
    expect(getDbCredentials(c.db, "migrator")).toEqual({ user: "app", pass: "p" });
  });
});