import { describe, it, expect } from "vitest";
import {
  resolveOpenAIConfig,
  validateProviderBaseUrl,
  OpenAIClient,
  DEFAULT_LLM_BASE_URL,
  DEFAULT_EMBEDDING_MODEL,
  FailoverChat,
  buildLlmChatClient,
  type ChatCompletions,
  type ChatCompletionResult,
} from "@/lib/openai/client";

function fakeChat(fn: (model: string) => ChatCompletionResult | Error): ChatCompletions {
  return {
    async chatCompletion(_messages, options) {
      const r = fn(options?.model ?? "");
      if (r instanceof Error) throw r;
      return r;
    },
  };
}

/** Stub `fetch` with an embeddings response body, and run `fn`. */
async function withEmbeddingResponse(
  body: unknown,
  fn: (client: OpenAIClient) => Promise<unknown>,
): Promise<unknown> {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
  try {
    return await fn(new OpenAIClient({ apiKey: "sk-test", baseUrl: "https://api.example.com/v1" }));
  } finally {
    globalThis.fetch = original;
  }
}

describe("embedding response validation", () => {
  /**
   * The embedding width is the tenant's choice — they configure their own provider
   * — so there is deliberately no fixed dimension to enforce (the old
   * EMBEDDING_DIMENSIONS env gate is gone). pgvector's column is dimension-flexible
   * and a width change is caught against the chatbot's own stored vectors instead.
   */
  it("accepts vectors of any width", async () => {
    const three = await withEmbeddingResponse({ data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }] }, (c) =>
      c.embedAsJsonArray("hi"),
    );
    expect(JSON.parse(three as string)).toEqual([0.1, 0.2, 0.3]);

    const wide = await withEmbeddingResponse(
      { data: [{ index: 0, embedding: Array.from({ length: 1024 }, () => 0.01) }] },
      (c) => c.embedAsJsonArray("hi"),
    );
    expect(JSON.parse(wide as string)).toHaveLength(1024);
  });

  it("rejects an empty vector", async () => {
    await expect(
      withEmbeddingResponse({ data: [{ index: 0, embedding: [] }] }, (c) => c.embedAsJsonArray("hi")),
    ).rejects.toThrow(/empty vector/);
  });

  it("rejects a non-finite value before it reaches pgvector", async () => {
    await expect(
      withEmbeddingResponse(
        { data: [{ index: 0, embedding: [0.1, Number.NaN, 0.3] }] },
        (c) => c.embedAsJsonArray("hi"),
      ),
    ).rejects.toThrow(/non-finite/);
  });

  it("rejects an out-of-range index", async () => {
    await expect(
      withEmbeddingResponse(
        { data: [{ index: 5, embedding: [0.1] }] },
        (c) => c.embedBatchAsJsonArray(["a", "b"]),
      ),
    ).rejects.toThrow(/out of range/);
  });
});

describe("resolveOpenAIConfig", () => {
  it("uses OpenAI defaults for empty settings", () => {
    const c = resolveOpenAIConfig({ openai_api_key: "sk" });
    expect(c.baseUrl).toBe(DEFAULT_LLM_BASE_URL);
    expect(c.apiKey).toBe("sk");
    expect(c.embeddingBaseUrl).toBe(DEFAULT_LLM_BASE_URL);
    expect(c.embeddingApiKey).toBe("sk");
    expect(c.embeddingModel).toBe(DEFAULT_EMBEDDING_MODEL);
  });

  it("falls back to the LLM provider for embeddings", () => {
    const c = resolveOpenAIConfig({ openai_api_key: "sk", llm_base_url: "https://llm.example/v1" });
    expect(c.baseUrl).toBe("https://llm.example/v1");
    expect(c.embeddingBaseUrl).toBe("https://llm.example/v1");
    expect(c.embeddingApiKey).toBe("sk");
  });

  it("allows separate embedding overrides", () => {
    const c = resolveOpenAIConfig({
      openai_api_key: "sk",
      llm_base_url: "https://llm.example/v1",
      embedding_base_url: "https://emb.example/v1",
      embedding_api_key: "embkey",
      embedding_model: "custom-local-model",
    });
    expect(c.baseUrl).toBe("https://llm.example/v1");
    expect(c.embeddingBaseUrl).toBe("https://emb.example/v1");
    expect(c.embeddingApiKey).toBe("embkey");
    expect(c.embeddingModel).toBe("custom-local-model");
  });

  it("trims trailing slashes from base URLs", () => {
    const c = resolveOpenAIConfig({ openai_api_key: "sk", llm_base_url: "https://llm.example/v1/" });
    expect(c.baseUrl).toBe("https://llm.example/v1");
  });
});

describe("validateProviderBaseUrl (SSRF guard)", () => {
  it("accepts a public host and normalises the trailing slash", () => {
    expect(validateProviderBaseUrl("https://api.example.com/v1/")).toBe("https://api.example.com/v1");
    expect(validateProviderBaseUrl("  ")).toBeNull();
  });

  it("refuses loopback, link-local, private and metadata addresses", () => {
    const blocked = [
      "http://localhost:11434/v1",
      "http://127.0.0.1:8080/v1",
      "http://169.254.169.254/latest/meta-data",
      "http://10.0.0.5/v1",
      "http://172.16.4.4/v1",
      "http://192.168.1.10/v1",
      "http://[::1]:11434/v1",
      "http://something.internal/v1",
    ];
    for (const url of blocked) {
      expect(() => validateProviderBaseUrl(url)).toThrow(/public host/);
    }
  });

  it("refuses non-http schemes and unparseable values", () => {
    expect(() => validateProviderBaseUrl("file:///etc/passwd")).toThrow(/http or https/);
    expect(() => validateProviderBaseUrl("gopher://x/1")).toThrow(/http or https/);
    expect(() => validateProviderBaseUrl("not a url")).toThrow(/valid absolute URL/);
  });

  it("allows a private host only with the explicit operator opt-in", () => {
    // Self-hosted Ollama / LM Studio / vLLM: the operator opts in, a tenant cannot.
    expect(validateProviderBaseUrl("http://localhost:11434/v1", { allowPrivate: true })).toBe(
      "http://localhost:11434/v1",
    );
    expect(validateProviderBaseUrl("http://192.168.1.10:8000/v1", { allowPrivate: true })).toBe(
      "http://192.168.1.10:8000/v1",
    );
    // Even opted in, the scheme still has to be sane.
    expect(() => validateProviderBaseUrl("file:///etc/passwd", { allowPrivate: true })).toThrow(/http or https/);
  });

  it("still refuses to build a client around a private URL by default", () => {
    // resolveOpenAIConfig reads the deployment config, whose default is public-only.
    expect(() =>
      resolveOpenAIConfig({ openai_api_key: "sk", llm_base_url: "http://169.254.169.254" }),
    ).toThrow(/public host/);
  });
});

describe("FailoverChat", () => {
  it("returns the first successful model", async () => {
    const f = new FailoverChat([
      { client: fakeChat(() => ({ content: "from-first", total_tokens: 1 })), model: "m1" },
      { client: fakeChat(() => ({ content: "from-second", total_tokens: 1 })), model: "m2" },
    ]);
    const r = await f.chatCompletion([]);
    expect(r.content).toBe("from-first");
  });

  it("fails over to the next model on error", async () => {
    const f = new FailoverChat([
      { client: fakeChat(() => { throw new Error("boom"); }), model: "m1" },
      { client: fakeChat(() => ({ content: "from-second", total_tokens: 1 })), model: "m2" },
    ]);
    const r = await f.chatCompletion([]);
    expect(r.content).toBe("from-second");
  });

  it("calls each model in order with its own model name and throws when all fail", async () => {
    const calls: string[] = [];
    const f = new FailoverChat([
      { client: fakeChat((m) => { calls.push(m); throw new Error("a"); }), model: "model-a" },
      { client: fakeChat((m) => { calls.push(m); throw new Error("b"); }), model: "model-b" },
    ]);
    await expect(f.chatCompletion([])).rejects.toThrow("b");
    expect(calls).toEqual(["model-a", "model-b"]);
  });
});

describe("buildLlmChatClient", () => {
  it("falls back to a single legacy client when the model list is empty", () => {
    const c = buildLlmChatClient([], null, resolveOpenAIConfig({ openai_api_key: "sk" }));
    expect(typeof c.chatCompletion).toBe("function");
  });
});