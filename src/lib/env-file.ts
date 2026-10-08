import { readFileSync } from "node:fs";

/**
 * Minimal `.env` loader for non-Next runtime paths (migration/worker scripts).
 * Next.js loads `.env` into process.env automatically for the app; standalone
 * `tsx` scripts do not, so they call this first. Mirrors PHP `config/config.php`.
 *
 * Only sets a key when it is not already present in the environment
 * (real environment variables win over `.env`).
 */
export function loadEnvFile(filePath: string): void {
  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch {
    return; // no .env file — rely on the real environment
  }

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    if (key === "") continue;

    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}