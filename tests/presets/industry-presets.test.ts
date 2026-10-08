import { describe, it, expect } from "vitest";
import { industryPresets, groupedPresets, presetCount } from "@/presets/industry-presets";

describe("industry presets (ported verbatim)", () => {
  it("has 27 categories and 101 presets", () => {
    expect(presetCount()).toEqual({ categories: 27, presets: 101 });
  });

  it("puts Custom first in groupedPresets with a blank prompt", () => {
    const grouped = groupedPresets();
    expect(grouped[0].category).toBe("Custom");
    expect(grouped[0].presets[0].label).toBe("Custom (write your own)");
    expect(grouped[0].presets[0].prompt).toBe("");
    expect(grouped).toHaveLength(27);
  });

  it("every prompt (except Custom + the source typo) carries the {company} placeholder", () => {
    for (const [category, presets] of Object.entries(industryPresets)) {
      for (const p of presets) {
        const isBlankCustom = p.prompt === "";
        const isSourceTypo = category === "Pharmaceuticals & Biotech" && p.label === "Clinical Trial Assistant";
        if (!isBlankCustom && !isSourceTypo) {
          expect(p.prompt, `${category} → ${p.label}`).toContain("{company}");
        }
      }
    }
  });

  it("every label is non-empty and unique", () => {
    const labels = new Set<string>();
    for (const presets of Object.values(industryPresets)) {
      for (const p of presets) {
        expect(p.label.length).toBeGreaterThan(0);
        labels.add(p.label);
      }
    }
    expect(labels.size).toBe(101);
  });

  it("includes the expected major categories", () => {
    const cats = Object.keys(industryPresets);
    for (const expected of ["Agriculture", "Healthcare", "Food & Beverage", "Technology & SaaS", "Real Estate"]) {
      expect(cats).toContain(expected);
    }
  });
});