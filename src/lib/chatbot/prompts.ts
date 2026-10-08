import raw from "./prompts.json";

/**
 * System-prompt templates ported byte-for-byte from PHP `ChatController`
 * (extracted via the PHP runtime to preserve single-quote `\n` / `\"` quirks).
 * See prompts.json — regenerated from the PHP source when it changes.
 */

export interface ChatPrompts {
  defaultSystemPrompt: string;
  ragContextPrefix: string;
  ragContextSuffix: string;
  leadCaptureInstruction: string;
  extractSystem: string;
}

export const CHAT_PROMPTS: ChatPrompts = raw;