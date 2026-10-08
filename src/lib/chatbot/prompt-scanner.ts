/**
 * PromptScanner — regex-based prompt-injection / jailbreak detector, ported
 * verbatim from PHP `Util/PromptScanner`. Case-insensitive, first-match-wins,
 * ordered by specificity.
 */
export type PromptScanCategory =
  | "ignore_instructions"
  | "system_override"
  | "jailbreak_reference"
  | "output_coercion"
  | "secret_extraction";

const PATTERNS: ReadonlyArray<readonly [RegExp, PromptScanCategory]> = [
  // Ignore / disregard instructions (the most common injection vector)
  [/\bignore\s+(all\s+)?(previous\s+)?(instructions?|directives?|prompts?|commands?|above|below|everything)\b/i, "ignore_instructions"],
  // System prompt override / role hijack
  [/\b(from\s+now\s+on|you\s+are\s+(now\s+)?)\b.*\b(you\s+(are|will)\s+)?(a\s+|the\s+)?(dan|chatgpt|free\s+(unlocked|mode)|unlocked|uncensored|unfiltered|raw\s*mode)\b/i, "system_override"],
  // Jailbreak references (DAN, developer mode, bypass, etc.)
  [/\b(do\s+anything\s+now|dan\s+(jail|mode|setup)|jail\s*break|prompt\s+injection|developer\s+mode|secret\s+mode|bypass\s+(safety|rules|filter|restrictions?)|god\s+mode|super\s+prompt)\b/i, "jailbreak_reference"],
  // Output format coercion
  [/\b(?:start|begin)\s+(?:your\s+)?(?:response|reply|answer)\s+with\b/i, "output_coercion"],
  // Token / secret extraction
  [/\b(reveal|show|display|print|output|spill|leak|extract|dump)\s+.*\b(system\s+prompt|initial\s+prompt|instructions?|directives?|api\s+key|token|password|secret)\b/i, "secret_extraction"],
];

export function scanPrompt(message: string): PromptScanCategory | null {
  for (const [re, label] of PATTERNS) {
    if (re.test(message)) return label;
  }
  return null;
}