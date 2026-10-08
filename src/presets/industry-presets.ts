import raw from "./industry-presets.json";

/**
 * Industry → system-prompt presets, ported verbatim from PHP
 * `IndustryPresets.php` (27 categories / 101 presets — not the README's "26" or
 * any higher count). Each preset is `{ label, prompt }` with a literal
 * `{company}` placeholder that is NOT resolved at runtime (matching PHP).
 *
 * Note: the "Pharmaceuticals & Biotech → Clinical Trial Assistant" preset has a
 * source typo `{company$` (missing `}`); preserved verbatim for parity.
 */

export interface IndustryPreset {
  label: string;
  prompt: string;
}

export const industryPresets: Record<string, IndustryPreset[]> = raw;

/** Categories ordered with "Custom" first (matches PHP IndustryTemplate::allGrouped). */
export function groupedPresets(): { category: string; presets: IndustryPreset[] }[] {
  const ordered = ["Custom", ...Object.keys(industryPresets).filter((c) => c !== "Custom")];
  return ordered.map((category) => ({ category, presets: industryPresets[category] }));
}

export function presetCount(): { categories: number; presets: number } {
  return {
    categories: Object.keys(industryPresets).length,
    presets: Object.values(industryPresets).reduce((n, p) => n + p.length, 0),
  };
}