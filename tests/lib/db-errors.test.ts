import { describe, it, expect } from "vitest";
import {
  DatabaseUnavailableError,
  asDatabaseUnavailable,
  isDatabaseUnavailable,
  DB_UNAVAILABLE_MESSAGE,
} from "@/lib/db-errors";
import { dbGuarded, dbUnavailableResponse } from "@/lib/db-error-response";
import { createPool } from "@/lib/db";

/** A pg-style driver error: a plain Error carrying a `code`. */
function driverError(code: string, message = "connect failed"): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

describe("isDatabaseUnavailable", () => {
  it("recognizes our own typed error", () => {
    const err = new DatabaseUnavailableError({ host: "127.0.0.1", port: 54329 }, new Error("nope"));
    expect(isDatabaseUnavailable(err)).toBe(true);
  });

  it("recognizes the errno pg raises when nothing is listening", () => {
    expect(isDatabaseUnavailable(driverError("ECONNREFUSED"))).toBe(true);
    expect(isDatabaseUnavailable(driverError("ENOTFOUND"))).toBe(true);
    expect(isDatabaseUnavailable(driverError("ETIMEDOUT"))).toBe(true);
  });

  it("recognizes libpq SQLSTATEs for connection failures and a server in recovery", () => {
    expect(isDatabaseUnavailable(driverError("08006"))).toBe(true); // connection_failure
    expect(isDatabaseUnavailable(driverError("08001"))).toBe(true); // unable_to_connect
    expect(isDatabaseUnavailable(driverError("57P03"))).toBe(true); // cannot_connect_now (starting up)
    expect(isDatabaseUnavailable(driverError("3D000"))).toBe(true); // database does not exist
  });

  it("recognizes a failure wrapped in AggregateError (multi-host DSN)", () => {
    const aggregate = new AggregateError([driverError("ECONNREFUSED")], "all hosts failed");
    expect(isDatabaseUnavailable(aggregate)).toBe(true);
  });

  it("recognizes a failure nested in `cause`", () => {
    const wrapped = new Error("query failed", { cause: driverError("ECONNRESET") });
    expect(isDatabaseUnavailable(wrapped)).toBe(true);
  });

  it("is NOT fooled by ordinary application and query errors", () => {
    expect(isDatabaseUnavailable(new Error("boom"))).toBe(false);
    expect(isDatabaseUnavailable(driverError("23505"))).toBe(false); // unique_violation
    expect(isDatabaseUnavailable(driverError("42501"))).toBe(false); // insufficient_privilege (RLS)
    expect(isDatabaseUnavailable(null)).toBe(false);
    expect(isDatabaseUnavailable(undefined)).toBe(false);
    expect(isDatabaseUnavailable("ECONNREFUSED")).toBe(false);
  });
});

describe("asDatabaseUnavailable", () => {
  it("keeps the driver error as cause and exposes a printable target", () => {
    const cause = driverError("ECONNREFUSED");
    const err = asDatabaseUnavailable(cause, { host: "127.0.0.1", port: 54329, database: "chatbot_assistant" });

    expect(err).toBeInstanceOf(DatabaseUnavailableError);
    expect(err.cause).toBe(cause);
    expect(err.target).toBe("127.0.0.1:54329");
    // The message must be safe to show a browser: no host, no port, no credentials.
    expect(err.message).toBe(DB_UNAVAILABLE_MESSAGE);
    expect(err.message).not.toContain("54329");
  });

  it("is idempotent", () => {
    const first = asDatabaseUnavailable(driverError("ECONNREFUSED"), { host: "h", port: 1 });
    expect(asDatabaseUnavailable(first, { host: "other", port: 2 })).toBe(first);
  });

  it("keeps the target off the browser-visible surface", () => {
    // The outage screen is reachable without signing in and gets no props at
    // all, so the only thing a visitor can ever read is this message.
    const err = asDatabaseUnavailable(driverError("ECONNREFUSED"), {
      host: "db.internal",
      port: 5432,
      database: "app",
    });
    expect(err.message).toBe("Database unavailable");
    for (const secret of ["db.internal", "5432", "app", "ECONNREFUSED"]) {
      expect(err.message).not.toContain(secret);
    }
  });
});

describe("createPool", () => {
  it("translates a refused connection into DatabaseUnavailableError", async () => {
    // Port 1 is privileged and unbound: connecting is refused immediately, so
    // this exercises the real driver path without needing a database.
    const pool = createPool({
      host: "127.0.0.1",
      port: 1,
      database: "nonexistent",
      user: "nobody",
      password: "wrong",
      schema: "chatbot_schema",
    });

    await expect(pool.connect()).rejects.toBeInstanceOf(DatabaseUnavailableError);
  }, 15000);
});

describe("dbUnavailableResponse", () => {
  it("answers 503 JSON with a Retry-After and the request origin allowed", async () => {
    const res = dbUnavailableResponse("https://example.com");

    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("30");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://example.com");
    expect(res.headers.get("Vary")).toBe("Origin");
    await expect(res.json()).resolves.toEqual({ error: DB_UNAVAILABLE_MESSAGE, retryable: true });
  });

  it("omits CORS headers when there is no origin", () => {
    expect(dbUnavailableResponse().headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("dbGuarded", () => {
  it("maps a database outage to 503 instead of letting it escape", async () => {
    const res = await dbGuarded(async () => {
      throw driverError("ECONNREFUSED");
    });

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: DB_UNAVAILABLE_MESSAGE, retryable: true });
  });

  it("rethrows errors that are not database outages, so real bugs stay visible", async () => {
    await expect(
      dbGuarded(async () => {
        throw driverError("23505", "duplicate key");
      }),
    ).rejects.toThrow("duplicate key");
  });

  it("passes a successful response straight through", async () => {
    const res = await dbGuarded(async () => dbUnavailableResponse());
    expect(res.status).toBe(503);
  });
});
