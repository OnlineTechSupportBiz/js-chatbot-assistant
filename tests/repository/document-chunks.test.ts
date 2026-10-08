import { describe, it, expect } from "vitest";
import {
  insertChunkBatch,
  searchByEmbedding,
  EmbeddingDimensionMismatchError,
} from "@/repository/document-chunks";
import { fakeDb } from "../helpers";

describe("document-chunks repository", () => {
  it("insertChunkBatch builds a multi-row INSERT with ::vector casts", async () => {
    const { db, calls } = fakeDb();
    await insertChunkBatch(db, 1, 3, 11, [
      { chunk_index: 0, chunk_text: "a", embedding: "[0.1,-0.2]" },
      { chunk_index: 1, chunk_text: "b", embedding: "[0.3,0.4]" },
    ]);
    const sql = calls[0].sql;
    expect(sql).toContain("$6::vector");
    expect(sql).toContain("$12::vector");
    expect(sql.match(/::vector/g)).toHaveLength(2); // two value tuples
    expect(calls[0].values).toHaveLength(12); // 2 chunks × 6 params
    expect(calls[0].values?.[4]).toBe("a"); // chunk_text of first row
  });

  it("returns no-op for empty batches", async () => {
    const { db, calls } = fakeDb();
    await insertChunkBatch(db, 1, 3, 11, []);
    expect(calls).toHaveLength(0);
  });

  it("searchByEmbedding converts cosine distance to similarity (rounded 6)", async () => {
    const { db, calls } = fakeDb((sql) =>
      sql.includes("vector_dims(embedding)")
        ? [{ stored: 2, query: 2 }]
        : [
            { id: 5, chunk_text: "text a", distance: 0.25 },
            { id: 6, chunk_text: "text b", distance: 0.9 },
          ],
    );
    const results = await searchByEmbedding(db, 1, 3, "[0.1,0.2]", 5);
    expect(results).toEqual([
      { id: 5, chunk_text: "text a", score: 0.75 },
      { id: 6, chunk_text: "text b", score: 0.1 },
    ]);
    const search = calls.find((c) => c.sql.includes("<=> $1::vector"));
    expect(search?.values).toEqual(["[0.1,0.2]", 1, 3, "[0.1,0.2]", 5]);
  });

  // The embedding width is the tenant's choice (they configure their own provider),
  // so nothing hardcodes it — the mismatch is caught against the chatbot's own
  // stored vectors instead.
  it("rejects a query embedding whose width differs from the stored vectors", async () => {
    const { db, calls } = fakeDb((sql) =>
      sql.includes("vector_dims(embedding)") ? [{ stored: 1536, query: 1024 }] : [],
    );
    await expect(searchByEmbedding(db, 1, 3, "[0.1,0.2]", 5)).rejects.toThrow(
      EmbeddingDimensionMismatchError,
    );
    // The distance query must never run with mismatched widths: pgvector would fail
    // with an opaque error instead of the actionable one.
    expect(calls.some((c) => c.sql.includes("<=>"))).toBe(false);
  });

  it("searches normally when the chatbot has no chunks yet", async () => {
    const { db, calls } = fakeDb((sql) =>
      sql.includes("vector_dims(embedding)") ? [] : [{ id: 1, chunk_text: "x", distance: 0 }],
    );
    const results = await searchByEmbedding(db, 1, 3, "[0.1,0.2]", 5);
    expect(results).toEqual([{ id: 1, chunk_text: "x", score: 1 }]);
    expect(calls.some((c) => c.sql.includes("<=>"))).toBe(true);
  });
});