import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs, discoverMigrations, grantAppPrivileges, renderSchema } from "@/db/migrate";

describe("parseArgs", () => {
  it("parses flags and a file argument", () => {
    expect(parseArgs(["002_foo.sql"])).toEqual({ fresh: false, dropOnly: false, file: "002_foo.sql" });
    expect(parseArgs(["--fresh"])).toEqual({ fresh: true, dropOnly: false, file: null });
    expect(parseArgs(["--drop"])).toEqual({ fresh: false, dropOnly: true, file: null });
    expect(parseArgs(["--fresh", "--drop", "003_bar.sql"])).toEqual({
      fresh: true,
      dropOnly: true,
      file: "003_bar.sql",
    });
  });

  it("ignores unknown --flags", () => {
    expect(parseArgs(["--squash", "001.sql"])).toEqual({
      fresh: false,
      dropOnly: false,
      file: "001.sql",
    });
  });
});

describe("discoverMigrations", () => {
  it("returns .sql files sorted by name, ignoring other files", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "migrate-"));
    try {
      writeFileSync(path.join(dir, "003_three.sql"), "");
      writeFileSync(path.join(dir, "001_one.sql"), "");
      writeFileSync(path.join(dir, "002_two.sql"), "");
      writeFileSync(path.join(dir, "README.txt"), "");

      expect(discoverMigrations(dir)).toEqual(["001_one.sql", "002_two.sql", "003_three.sql"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("renderSchema", () => {
  it("substitutes {{schema}} as a quoted identifier", () => {
    expect(renderSchema("CREATE TABLE {{schema}}.users (id int);", "acme_prod")).toBe(
      'CREATE TABLE "acme_prod".users (id int);',
    );
  });

  it("quotes a schema name that needs it", () => {
    expect(renderSchema("SELECT * FROM {{schema}}.t;", 'My Schema')).toBe(
      'SELECT * FROM "My Schema".t;',
    );
  });

  it("escapes an embedded double quote rather than breaking out of the identifier", () => {
    expect(renderSchema("SELECT {{schema}};", 'a"b')).toBe('SELECT "a""b";');
  });

  it("replaces every occurrence, not just the first", () => {
    expect(renderSchema("{{schema}}.a JOIN {{schema}}.b ON 1=1;", "s")).toBe(
      '"s".a JOIN "s".b ON 1=1;',
    );
  });

  it("leaves SQL with no placeholder untouched", () => {
    expect(renderSchema("SELECT 1;", "s")).toBe("SELECT 1;");
  });

  it("never leaves an operator-specific name from the shipped migration file", () => {
    // The single shipped migration must stay deployment-agnostic: schema via
    // {{schema}}, and no role names at all (the runner owns what it creates and
    // grantAppPrivileges() handles the app role). A pg_dump-derived file bakes
    // in whatever schema/roles the dumping machine had, which breaks every
    // other install.
    const file = readFileSync(
      path.join(process.cwd(), "src/db/migrations/001_initial.sql"),
      "utf8",
    );
    expect(file).not.toMatch(/\bjs_chatbot_/);
    expect(file).not.toMatch(/\bchatbot_(schema|user|migrator)\b/);
    expect(file).toContain("{{schema}}");
  });
});

describe("grantAppPrivileges", () => {
  it("issues schema/table/sequence + default-privilege grants to the app role", async () => {
    const queries: { sql: string; values?: unknown[] }[] = [];
    const client = {
      query(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        return Promise.resolve({ rows: [], rowCount: null });
      },
      release() {},
    };

    await grantAppPrivileges(client as never, "chatbot_schema", "chatbot_user");

    const all = queries.map((q) => q.sql).join("\n");
    expect(queries).toHaveLength(5);
    expect(all).toContain('GRANT USAGE ON SCHEMA "chatbot_schema" TO "chatbot_user"');
    expect(all).toContain(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "chatbot_schema" TO "chatbot_user"',
    );
    expect(all).toContain(
      'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA "chatbot_schema" TO "chatbot_user"',
    );
    expect(all).toContain("ALTER DEFAULT PRIVILEGES IN SCHEMA");
  });
});