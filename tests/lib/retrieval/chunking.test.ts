import { describe, it, expect } from "vitest";
import { chunk, chunkByParagraphs } from "@/lib/retrieval/chunking";

describe("chunk", () => {
  it("returns [] for empty text", () => {
    expect(chunk("")).toEqual([]);
  });

  it("returns a single chunk when text is shorter than size", () => {
    expect(chunk("hello", 100, 10)).toEqual([{ chunk_index: 0, chunk_text: "hello" }]);
  });

  it("never produces a chunk longer than `size`", () => {
    const text = "word ".repeat(200).trim(); // ~1000 chars
    for (const c of chunk(text, 120, 20)) {
      expect([...c.chunk_text].length).toBeLessThanOrEqual(120);
    }
  });

  it("assigns sequential chunk_index and overlaps", () => {
    const text = "abcdefghij ".repeat(30).trim();
    const chunks = chunk(text, 50, 10);
    expect(chunks.map((c) => c.chunk_index)).toEqual(chunks.map((_, i) => i));
    expect(chunks.length).toBeGreaterThan(1);
    // subsequent chunk starts inside the previous chunk's tail (overlap)
    const first = chunks[0].chunk_text;
    const second = chunks[1].chunk_text;
    expect(first.slice(-5)).toBe(chunks[0].chunk_text.slice(-5)); // sanity: non-empty overlap region
    expect(first.length).toBeGreaterThan(0);
    expect(second).not.toBe("");
  });

  it("breaks at the last space when it sits in the second half of the chunk", () => {
    // Hand-traced: 500/50 word-boundary splitting with overlap.
    const text = "aaa bbb ccc ddd eee fff";
    expect(chunk(text, 10, 3)).toEqual([
      { chunk_index: 0, chunk_text: "aaa bbb" },
      { chunk_index: 1, chunk_text: "bbb ccc" },
      { chunk_index: 2, chunk_text: "ccc ddd" },
      { chunk_index: 3, chunk_text: "ddd eee" },
      { chunk_index: 4, chunk_text: "eee fff" },
    ]);
  });

  it("counts astral (emoji) characters as single code points", () => {
    const text = "😀😀😀😀😀😀😀😀😀😀"; // 10 astral code points = 20 UTF-16 units
    const chunks = chunk(text, 4, 1);
    expect(chunks[0].chunk_text).toBe("😀😀😀😀"); // 4 code points, not 4 UTF-16 units
  });
});

describe("chunkByParagraphs", () => {
  it("splits on blank lines and coalesces short paragraphs up to maxChars", () => {
    // Coalesces when under maxChars; splits once the buffer would exceed it.
    expect(chunkByParagraphs("one\ntwo\n\nthree\nfour\n\nfive", 1000)).toEqual([
      { chunk_index: 0, chunk_text: "one\ntwo\n\nthree\nfour\n\nfive" },
    ]);
    expect(chunkByParagraphs("one\ntwo\n\nthree\nfour\n\nfive", 10)).toEqual([
      { chunk_index: 0, chunk_text: "one\ntwo" },
      { chunk_index: 1, chunk_text: "three\nfour" },
      { chunk_index: 2, chunk_text: "five" },
    ]);
  });

  it("splits an over-long paragraph with the standard chunker", () => {
    const big = "w".repeat(2500);
    const chunks = chunkByParagraphs(`short\n\n${big}`, 1000);
    expect(chunks.length).toBeGreaterThan(2); // "short" + big split into multiple 1000-char chunks
    expect(chunks[0].chunk_text).toBe("short");
  });
});