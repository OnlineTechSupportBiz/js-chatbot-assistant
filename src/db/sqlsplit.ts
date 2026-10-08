/**
 * Split a multi-statement SQL string on `;`, preserving semicolons that appear
 * inside single-quoted strings or PostgreSQL dollar-quoted bodies (`$$…$$` or
 * `$tag$…$tag$`). Ported faithfully from the PHP installer (public_html/install.php,
 * run_migrations step) so the migration runner produces identical statements.
 */

export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];

  // Strip `--` comment lines so a semicolon inside a comment doesn't split.
  const cleaned = sql.replace(/^\s*--.*$/gm, "");

  let buf = "";
  let i = 0;
  const len = cleaned.length;
  let dqTag: string | null = null; // null = not in dollar-quote; otherwise the opening tag
  let sq = false; // in single-quote string

  while (i < len) {
    const ch = cleaned[i];

    if (sq) {
      if (ch === "'") {
        // escaped quote ''
        if (i + 1 < len && cleaned[i + 1] === "'") {
          buf += "''";
          i += 2;
          continue;
        }
        buf += "'";
        sq = false;
      } else {
        buf += ch;
      }
      i++;
      continue;
    }

    if (dqTag !== null) {
      if (cleaned.slice(i, i + dqTag.length) === dqTag) {
        buf += dqTag;
        i += dqTag.length;
        dqTag = null;
        continue;
      }
      buf += ch;
      i++;
      continue;
    }

    if (ch === "'") {
      buf += "'";
      sq = true;
      i++;
      continue;
    }

    if (ch === "$") {
      const tagEnd = cleaned.indexOf("$", i + 1);
      if (tagEnd !== -1) {
        const tag = cleaned.slice(i, tagEnd + 1);
        buf += tag;
        dqTag = tag;
        i = tagEnd + 1;
        continue;
      }
    }

    if (ch === ";") {
      const stmt = buf.trim();
      if (stmt !== "") {
        statements.push(stmt);
      }
      buf = "";
      i++;
      continue;
    }

    buf += ch;
    i++;
  }

  const last = buf.trim();
  if (last !== "") {
    statements.push(last);
  }

  return statements;
}