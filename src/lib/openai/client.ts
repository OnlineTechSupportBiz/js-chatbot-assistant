/**
 * OpenAI-compatible client — port of PHP `Service/OpenAIClient` (chat completions
 * + embeddings), generalized so the LLM and embedding providers can each point at
 * any OpenAI-compatible endpoint (OpenAI, a proxy, or a self-hosted/local server
 * such as Ollama, LM Studio or vLLM).
 *
 * The chat pipeline depends only on the narrow `ChatCompletions` / `Embeddings`
 * interfaces so tests inject a fake and never touch the network.
 */

import { getConfig } from "@/lib/config";

export const DEFAULT_LLM_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionResult {
  content: string;
  total_tokens: number;
}

export interface ChatCompletionOptions {
  model?: string;
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: "json_object" };
}

export interface ChatCompletions {
  chatCompletion(messages: ChatMessage[], options?: ChatCompletionOptions): Promise<ChatCompletionResult>;
}

export interface Embeddings {
  /** Single-text embedding as a JSON array string for pgvector ::vector cast. */
  embedAsJsonArray(text: string): Promise<string>;
  /** Batch embeddings as JSON array strings (index-aligned). */
  embedBatchAsJsonArray(texts: string[]): Promise<string[]>;
}

export interface OpenAIClientConfig {
  baseUrl: string;
  apiKey: string;
  embeddingBaseUrl?: string;
  embeddingApiKey?: string;
  embeddingModel?: string;
}

/**
 * Resolve a client config from per-user model settings. Empty fields fall back to
 * the OpenAI defaults, or to the LLM provider (so one self-hosted endpoint can
 * serve both chat and embeddings with no extra configuration).
 */
export function resolveOpenAIConfig(settings: {
  openai_api_key: string | null;
  llm_base_url?: string | null;
  embedding_base_url?: string | null;
  embedding_api_key?: string | null;
  embedding_model?: string | null;
}): OpenAIClientConfig {
  const baseUrl =
    validateProviderBaseUrl(settings.llm_base_url, {
      allowPrivate: getConfig().allowPrivateProviderUrls,
    }) ?? DEFAULT_LLM_BASE_URL;
  return {
    baseUrl,
    apiKey: settings.openai_api_key ?? "",
    embeddingBaseUrl:
      validateProviderBaseUrl(settings.embedding_base_url, {
        allowPrivate: getConfig().allowPrivateProviderUrls,
      }) ?? baseUrl,
    embeddingApiKey: (settings.embedding_api_key ?? "").trim() || settings.openai_api_key || "",
    embeddingModel: (settings.embedding_model ?? "").trim() || DEFAULT_EMBEDDING_MODEL,
  };
}

/**
 * Provider base URLs come from the tenant's own settings and are fetched
 * server-side, so an unvalidated value turns the app into a request forwarder to
 * anything the host can reach: cloud metadata (169.254.169.254), loopback, or any
 * RFC1918 address. Only a public https/http host is accepted, and private /
 * link-local / loopback targets are refused.
 */
/** A rejected provider base URL carries a user-facing message (settings save shows it verbatim). */
export class ProviderUrlValidationError extends Error {}

export function validateProviderBaseUrl(
  raw: string | null | undefined,
  options: { allowPrivate?: boolean } = {},
): string | null {
  const value = (raw ?? "").trim();
  if (value === "") return null;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ProviderUrlValidationError("Provider URL must be a valid absolute URL (e.g. https://api.openai.com/v1).");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ProviderUrlValidationError("Provider URL must use http or https.");
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (isBlockedHost(host) && !options.allowPrivate) {
    throw new ProviderUrlValidationError(
      "Provider URL must point at a public host (loopback and private addresses are not allowed). " +
        "Set ALLOW_PRIVATE_PROVIDER_URLS=true to use a self-hosted provider.",
    );
  }

  return value.replace(/\/+$/, "");
}

function isBlockedHost(host: string): boolean {
  if (host === "" || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
    return true;
  }
  // IPv6 literal
  if (host.includes(":")) {
    if (host === "::1" || host === "::") return true;
    if (host.startsWith("fe80") || host.startsWith("fc") || host.startsWith("fd")) return true; // link-local / ULA
    // IPv4-mapped form (::ffff:10.0.0.1)
    const mapped = host.match(/::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (mapped) return isBlockedHost(mapped[1]);
    return false;
  }
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local incl. cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  return false;
}

export class OpenAIClient implements ChatCompletions, Embeddings {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly embeddingBaseUrl: string;
  private readonly embeddingApiKey: string;
  private readonly embeddingModel: string;

  /** Accepts a full config object, or a bare API key (OpenAI defaults) for back-compat. */
  constructor(config: string | OpenAIClientConfig) {
    if (typeof config === "string") {
      this.baseUrl = DEFAULT_LLM_BASE_URL;
      this.apiKey = config;
      this.embeddingBaseUrl = this.baseUrl;
      this.embeddingApiKey = config;
      this.embeddingModel = DEFAULT_EMBEDDING_MODEL;
    } else {
      const baseUrl = (config.baseUrl || DEFAULT_LLM_BASE_URL).replace(/\/$/, "");
      this.baseUrl = baseUrl;
      this.apiKey = config.apiKey;
      this.embeddingBaseUrl = (config.embeddingBaseUrl || baseUrl).replace(/\/$/, "");
      this.embeddingApiKey = config.embeddingApiKey ?? this.apiKey;
      this.embeddingModel = config.embeddingModel || DEFAULT_EMBEDDING_MODEL;
    }
  }

  /** PHP `floatArrayToJsonArray`: 8-decimal floats, comma-joined, wrapped in [ ]. */
  private floatsToJsonArray(floats: number[]): string {
    return "[" + floats.map((f) => f.toFixed(8)).join(",") + "]";
  }

  async embedAsJsonArray(text: string): Promise<string> {
    const results = await this.embedBatchAsJsonArray([text]);
    return results[0] ?? "";
  }

  async embedBatchAsJsonArray(texts: string[]): Promise<string[]> {
    if (texts.length === 0) return [];

    const resp = await fetch(`${this.embeddingBaseUrl}/embeddings`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.embeddingApiKey}`,
      },
      body: JSON.stringify({ model: this.embeddingModel, input: texts }),
    });

    if (!resp.ok) {
      throw new Error(`Embedding failed (HTTP ${resp.status})`);
    }

    const data = (await resp.json()) as { data?: Array<{ index?: number; embedding?: number[] }> };
    if (!data?.data) {
      throw new Error("Embedding: unexpected response structure");
    }

    const results: string[] = new Array(texts.length).fill("");
    // Validate the shape before anything is written. The pgvector column is
    // dimension-flexible (migration 005) and the width is the tenant's choice —
    // they configure their own embedding provider — so there is no fixed dimension
    // to check against here. What is still checked is that the response is usable:
    // an out-of-range index silently overwrote slot 0, a non-finite value poisons
    // every later distance calculation, and an empty vector is not a vector.
    // A *changing* width (model switched without re-indexing) is caught against the
    // chatbot's own stored vectors, at search time — see `searchByEmbedding`.
    for (const item of data.data) {
      const idx = item.index ?? 0;
      if (!item.embedding) continue;
      if (!Number.isInteger(idx) || idx < 0 || idx >= results.length) {
        throw new Error(`Embedding: response index ${idx} is out of range`);
      }
      const vector = item.embedding;
      if (vector.length === 0) {
        throw new Error("Embedding: response contained an empty vector");
      }
      if (vector.some((v) => typeof v !== "number" || !Number.isFinite(v))) {
        throw new Error("Embedding: response contained a non-finite value");
      }
      results[idx] = this.floatsToJsonArray(vector);
    }
    return results;
  }

  async chatCompletion(messages: ChatMessage[], options: ChatCompletionOptions = {}): Promise<ChatCompletionResult> {
    const body = {
      model: "gpt-4.1-mini",
      messages,
      temperature: 0.0,
      max_tokens: 1024,
      ...options,
    };

    const resp = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      throw new Error(`Chat completion failed (HTTP ${resp.status})`);
    }

    const data = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { total_tokens?: number };
    };

    if (!data?.choices?.[0]?.message || typeof data.choices[0].message.content !== "string") {
      throw new Error("Chat: unexpected response structure");
    }

    return {
      content: data.choices[0].message.content,
      total_tokens: data.usage?.total_tokens ?? 0,
    };
  }
}

/**
 * A chat client that tries each configured model in order, failing over to the
 * next on error (multi-model failover). Each entry carries its own client
 * (base URL + key) and the model string it should call.
 */
export class FailoverChat implements ChatCompletions {
  constructor(private readonly entries: { client: ChatCompletions; model: string }[]) {}

  async chatCompletion(messages: ChatMessage[], options: ChatCompletionOptions = {}): Promise<ChatCompletionResult> {
    let lastErr: unknown = new Error("No LLM model configured");
    for (const entry of this.entries) {
      try {
        return await entry.client.chatCompletion(messages, { ...options, model: entry.model });
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  }
}

export interface LlmModelEntry {
  name: string;
  base_url: string;
  api_key: string;
  model: string;
}

/**
 * Build a chat client from the user's ordered LLM model list, prioritising the
 * selected model (matched by name) and failing over through the rest in order.
 * Falls back to a single legacy client when the list is empty (the pre-model-list
 * behavior, driven by `openai_api_key` / `llm_base_url`).
 */
export function buildLlmChatClient(
  models: LlmModelEntry[],
  selectedName: string | null | undefined,
  legacy: OpenAIClientConfig,
): ChatCompletions {
  if (models.length === 0) {
    return new OpenAIClient(legacy);
  }
  const selected = models.find((m) => m.name === selectedName);
  const ordered = selected ? [selected, ...models.filter((m) => m.name !== selectedName)] : models;
  return new FailoverChat(
    ordered.map((m) => ({
      client: new OpenAIClient({ baseUrl: m.base_url || DEFAULT_LLM_BASE_URL, apiKey: m.api_key }),
      model: m.model,
    })),
  );
}