import { describe, it, expect } from "vitest";
import { CURATED_LABELS, listTimezoneOptions, listTimezones, validateTimezone } from "@/lib/timezones";

describe("listTimezoneOptions", () => {
  it("returns IANA values with human-readable labels", () => {
    const options = listTimezoneOptions();
    expect(options.length).toBeGreaterThan(100);

    // The dropdown must show a name, not the raw identifier.
    const phoenix = options.find((o) => o.value === "America/Phoenix");
    expect(phoenix).toBeDefined();
    expect(phoenix?.label).toBe("US Mountain (Phoenix — no DST)");
    expect(phoenix?.label).not.toBe(phoenix?.value);
  });

  it("uses PHP's exact wording, since both backends share this dropdown", () => {
    // Copied verbatim from App\Util\DateTimeHelper::TIMEZONES. If PHP re-words a
    // label, this is the place that should follow.
    const byValue = new Map(listTimezoneOptions().map((o) => [o.value, o.label]));
    for (const [value, label] of Object.entries(CURATED_LABELS)) {
      expect(byValue.get(value), `label for ${value}`).toBe(label);
    }
  });

  it("offers every curated zone, i.e. the runtime recognises all of PHP's ids", () => {
    const values = new Set(listTimezones());
    for (const value of Object.keys(CURATED_LABELS)) {
      expect(values.has(value), `${value} missing from the option list`).toBe(true);
    }
  });

  it("puts UTC first: it is the schema default and absent from Intl.supportedValuesOf", () => {
    expect(listTimezoneOptions()[0]).toEqual({
      value: "UTC",
      label: "UTC (Coordinated Universal Time)",
    });
  });

  it("gives the long tail a generated label in PHP's 'Region (City)' shape", () => {
    const byValue = new Map(listTimezoneOptions().map((o) => [o.value, o.label]));
    expect(byValue.get("Africa/Abidjan")).toBe("Africa (Abidjan)");
    expect(byValue.get("America/Indiana/Knox")).toBe("Indiana (Knox)");
    expect(byValue.get("Atlantic/Reykjavik")).toBe("Atlantic (Reykjavik)");
  });

  it("has no duplicates and no unlabelled entries", () => {
    const options = listTimezoneOptions();
    expect(new Set(options.map((o) => o.value)).size).toBe(options.length);
    for (const o of options) {
      expect(o.label.trim(), `empty label for ${o.value}`).not.toBe("");
      expect(o.value.trim()).toBe(o.value);
    }
  });
});

describe("validateTimezone", () => {
  it("accepts real zones", () => {
    expect(validateTimezone("UTC")).toBeNull();
    expect(validateTimezone("America/Denver")).toBeNull();
    expect(validateTimezone("Asia/Kolkata")).toBeNull();
    expect(validateTimezone("  Europe/Paris  ")).toBeNull(); // trimmed
  });

  it("accepts legacy aliases ICU still understands, so existing rows keep working", () => {
    // "US/Mountain" is valid to Intl but absent from Intl.supportedValuesOf.
    expect(validateTimezone("US/Mountain")).toBeNull();
  });

  it("rejects empty, unknown, and over-long values", () => {
    expect(validateTimezone("")).toMatch(/required/i);
    expect(validateTimezone("   ")).toMatch(/required/i);
    expect(validateTimezone("Not/AZone")).toMatch(/Unknown timezone/);
    expect(validateTimezone("../../etc/passwd")).toMatch(/Unknown timezone/);
    expect(validateTimezone("A".repeat(65))).toMatch(/too long/i);
  });
});
