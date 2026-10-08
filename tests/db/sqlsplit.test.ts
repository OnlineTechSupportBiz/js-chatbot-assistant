import { describe, it, expect } from "vitest";
import { splitSqlStatements } from "@/db/sqlsplit";

describe("splitSqlStatements", () => {
  it("splits simple statements on semicolons", () => {
    expect(splitSqlStatements("SELECT 1; SELECT 2;")).toEqual(["SELECT 1", "SELECT 2"]);
  });

  it("drops empty/whitespace-only statements", () => {
    expect(splitSqlStatements(";\n  ;\nSELECT 1;;")).toEqual(["SELECT 1"]);
  });

  it("keeps a trailing statement with no terminating semicolon", () => {
    expect(splitSqlStatements("SELECT 1; SELECT 2")).toEqual(["SELECT 1", "SELECT 2"]);
  });

  it("ignores semicolons inside -- comment lines", () => {
    const sql = "-- a comment; with semicolon\nSELECT 1;";
    expect(splitSqlStatements(sql)).toEqual(["SELECT 1"]);
  });

  it("ignores semicolons inside $$ dollar-quoted bodies", () => {
    const sql = `CREATE FUNCTION f() RETURNS int AS $$
SELECT 1;
RETURN 1;
$$ LANGUAGE sql;
SELECT 2;`;
    expect(splitSqlStatements(sql)).toEqual([
      "CREATE FUNCTION f() RETURNS int AS $$\nSELECT 1;\nRETURN 1;\n$$ LANGUAGE sql",
      "SELECT 2",
    ]);
  });

  it("respects a custom dollar-quote tag", () => {
    const sql = `DO $body$
BEGIN
  RAISE NOTICE 'hi';
END
$body$;
SELECT 1;`;
    expect(splitSqlStatements(sql)).toEqual([
      `DO $body$\nBEGIN\n  RAISE NOTICE 'hi';\nEND\n$body$`,
      "SELECT 1",
    ]);
  });

  it("ignores semicolons inside single-quoted strings and handles '' escapes", () => {
    const sql = `INSERT INTO t VALUES ('a;b', 'it''s'); SELECT 1;`;
    expect(splitSqlStatements(sql)).toEqual([
      "INSERT INTO t VALUES ('a;b', 'it''s')",
      "SELECT 1",
    ]);
  });
});