import { describe, it, expect } from "vitest";
import { parsePollResult } from "@/lib/llamaparse/client";

describe("parsePollResult", () => {
  it("extracts markdown from the top-level string", () => {
    const r = parsePollResult({ job: { status: "COMPLETED" }, markdown: "# hello" });
    expect(r).toEqual({ status: "COMPLETED", markdown: "# hello", error_message: null });
  });

  it("extracts markdown from result.markdown", () => {
    const r = parsePollResult({ job: { status: "COMPLETED" }, result: { markdown: "body" } });
    expect(r.markdown).toBe("body");
  });

  it("concatenates markdown.pages[]", () => {
    const r = parsePollResult({
      job: { status: "COMPLETED" },
      markdown: { pages: [{ markdown: "p1" }, { markdown: "p2" }, { other: true }] },
    });
    expect(r.markdown).toBe("p1\n\np2");
  });

  it("falls back to result.text / text", () => {
    expect(parsePollResult({ job: { status: "COMPLETED" }, result: { text: "txt" } }).markdown).toBe("txt");
    expect(parsePollResult({ job: { status: "COMPLETED" }, text: "txt2" }).markdown).toBe("txt2");
    expect(parsePollResult({ job: { status: "COMPLETED" } }).markdown).toBeNull();
  });

  it("reports FAILED status and error_message", () => {
    const r = parsePollResult({ job: { status: "FAILED", error_message: "bad input" } });
    expect(r.status).toBe("FAILED");
    expect(r.error_message).toBe("bad input");
  });

  it("defaults to PENDING when no status", () => {
    expect(parsePollResult({}).status).toBe("PENDING");
  });
});