import type { ChatbotRow } from "@/repository/chatbots";
import type { ChatCompletions } from "@/lib/openai/client";
import {
  getOutlineByChatbot,
  getContentByIds,
  countIndexedDocumentsByChatbot,
  buildPageIndexTree,
  renderOutline,
} from "@/repository/document-page-index";
import type { RetrievalDeps, RetrievalResult, RetrievalStrategy } from "@/lib/retrieval/engine";

/**
 * PageIndexStrategy — vectorless, LLM-guided retrieval. Sends the document's
 * heading outline to the LLM, which returns the IDs of relevant sections; those
 * sections' content is then fetched and used as context.
 */

const NAV_SYSTEM_PROMPT = `You are a document retrieval assistant. Your job is to navigate a document's table
of contents to find the sections most relevant to the user's question.

Below is the document outline. Each entry has an [id:N] marker identifying the section.
The outline is hierarchical — indentation shows parent-child relationships.

Read the user's question and mentally simulate how a human would skim this table of
contents to find the answer. Then return ONLY a JSON array of the most relevant
section IDs that would contain the answer.

Rules:
- Return a JSON array of integers, e.g. [123, 456, 789]
- Return an empty array [] if NO section seems relevant
- Do NOT include parent sections that have no content of their own
- Prefer leaf/section nodes over root nodes
- Return at most {MAX_NODES} IDs
- Return ONLY the JSON array, no other text or explanation

Document Outline:
{OUTLINE}`;

export class PageIndexStrategy implements RetrievalStrategy {
  constructor(private readonly openai: ChatCompletions) {}

  async retrieve({ db, adminId, chatbot, query, options }: RetrievalDeps): Promise<RetrievalResult> {
    const chatbotId = chatbot.id;
    const indexed = await countIndexedDocumentsByChatbot(db, adminId, chatbotId);
    if (indexed <= 0) return { context: "", source: "llm_only", chunksUsed: 0 };

    const outlineRows = await getOutlineByChatbot(db, adminId, chatbotId);
    if (outlineRows.length === 0) return { context: "", source: "llm_only", chunksUsed: 0 };

    const tree = buildPageIndexTree(outlineRows);
    const outlineText = renderOutline(tree);

    const selectedIds = await this.selectRelevantSections(query, outlineText, chatbot, options);
    if (selectedIds.length === 0) return { context: "", source: "llm_only", chunksUsed: 0 };

    const contentRows = await getContentByIds(db, adminId, chatbotId, selectedIds);
    if (contentRows.length === 0) return { context: "", source: "llm_only", chunksUsed: 0 };

    const parts: string[] = [];
    for (const row of contentRows) {
      const heading = row.heading ?? "";
      const content = row.content ?? "";
      if (content === "") continue;
      parts.push(heading ? `## ${heading}\n\n${content}` : content);
    }
    if (parts.length === 0) return { context: "", source: "llm_only", chunksUsed: 0 };

    return {
      context: parts.join("\n\n---\n\n"),
      source: "page_index",
      chunksUsed: selectedIds.length,
      metadata: { node_ids: selectedIds },
    };
  }

  private async selectRelevantSections(
    query: string,
    outlineText: string,
    chatbot: ChatbotRow,
    options?: { top_k?: number; max_nodes?: number },
  ): Promise<number[]> {
    const modelConfig = chatbot.model_config ?? { temperature: 0, max_tokens: 1024, model: "gpt-4.1-mini" };
    const model = modelConfig.model ?? "gpt-4.1-mini";
    const maxNodes = options?.max_nodes ?? 5;

    const systemPrompt = NAV_SYSTEM_PROMPT.replace("{MAX_NODES}", String(maxNodes)).replace("{OUTLINE}", outlineText);

    try {
      const result = await this.openai.chatCompletion(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: `User question: ${query}` },
        ],
        { model, temperature: 0.1, max_tokens: 500 },
      );
      const reply = result.content.trim();

      // Prefer extracting a JSON array embedded in the reply, then the whole reply.
      const arrayMatch = reply.match(/\[[\d,\s]*\]/);
      if (arrayMatch) {
        const ids = parseIdArray(arrayMatch[0]);
        if (ids) return ids.slice(0, maxNodes);
      }
      const ids = parseIdArray(reply);
      if (ids) return ids.slice(0, maxNodes);
    } catch {
      // API failure or bad JSON — silently return empty.
    }

    return [];
  }
}

function parseIdArray(text: string): number[] | null {
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.map((v) => parseInt(String(v), 10)).filter((n) => !Number.isNaN(n));
    }
  } catch {
    /* not JSON */
  }
  return null;
}