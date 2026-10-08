import { describe, it, expect } from "vitest";
import { parseSections, nodeTypeFor, buildPageIndex } from "@/lib/retrieval/page-index-builder";
import { buildPageIndexTree, renderOutline } from "@/repository/document-page-index";

describe("parseSections", () => {
  it("matches PHP exactly (including the intermediate-section first-line drop)", () => {
    const text =
      "Intro text before any heading.\n\n# Introduction\nThis is the intro content.\nLine two of intro.\n\n## Background\nBackground details here.\n\n### History\nMore history.\n\n# Conclusion\nFinal words.\n";
    expect(parseSections(text)).toEqual([
      { heading: "Introduction", level: 1, content: "Line two of intro." },
      { heading: "Background", level: 2, content: "" },
      { heading: "History", level: 3, content: "" },
      { heading: "Conclusion", level: 1, content: "Final words." },
    ]);
  });

  it("returns [] for text with no headings", () => {
    expect(parseSections("No headings at all, just plain text.\nAnother line.\n")).toEqual([]);
  });

  it("handles optional closing # characters", () => {
    const text = "# Title #\nBody line one.\nBody line two.\n";
    expect(parseSections(text)).toEqual([{ heading: "Title", level: 1, content: "Body line one.\nBody line two." }]);
  });
});

describe("nodeTypeFor", () => {
  it("maps levels to node types", () => {
    expect(nodeTypeFor(1)).toBe("section");
    expect(nodeTypeFor(2)).toBe("subsection");
    expect(nodeTypeFor(3)).toBe("leaf");
    expect(nodeTypeFor(4)).toBe("leaf");
  });
});

describe("renderOutline / buildPageIndexTree", () => {
  it("renders a nested tree with [id:N] markers and the depth-0 # prefix", () => {
    const tree = buildPageIndexTree([
      { id: 1, parent_id: null, heading: "Introduction", heading_level: 1, document_id: 5, node_type: "section", node_order: 0 },
      { id: 2, parent_id: 1, heading: "Background", heading_level: 2, document_id: 5, node_type: "subsection", node_order: 1 },
      { id: 3, parent_id: null, heading: "Conclusion", heading_level: 1, document_id: 5, node_type: "section", node_order: 2 },
    ]);
    expect(renderOutline(tree)).toBe(
      "[id:1] # Introduction\n  [id:2] Background\n[id:3] # Conclusion",
    );
  });

  it("renders null headings as (untitled) with no # prefix", () => {
    const tree = buildPageIndexTree([{ id: 1, parent_id: null, heading: null, heading_level: null, document_id: 5, node_type: "root", node_order: 0 }]);
    expect(renderOutline(tree)).toBe("[id:1] (untitled)");
  });
});

describe("buildPageIndex", () => {
  it("stores a root node when there are no headings", async () => {
    const calls: Array<{ sql: string; values?: unknown[] }> = [];
    const db = {
      query: async (sql: string, values?: unknown[]) => {
        calls.push({ sql, values });
        return /RETURNING id/.test(sql) ? { rows: [{ id: 1 }], rowCount: 1 } : { rows: [], rowCount: 0 };
      },
      release: () => {},
    };
    const n = await buildPageIndex(db, 1, 3, 7, "plain text, no headings");
    expect(n).toBe(1);
    expect(calls.some((c) => c.sql.includes("INSERT INTO document_page_index"))).toBe(true);
  });

  it("relates child nodes to the nearest lower-level parent", async () => {
    const ups: Array<{ sql: string; values?: unknown[] }> = [];
    const db = {
      query: async (sql: string, values?: unknown[]) => {
        ups.push({ sql, values });
        if (/INSERT INTO document_page_index/.test(sql)) {
          return { rows: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }], rowCount: 4 };
        }
        return { rows: [], rowCount: 0 };
      },
      release: () => {},
    };
    const text = "# A\nx\n\n## B\ny\n\n## C\nz\n";
    const n = await buildPageIndex(db, 1, 3, 7, text);
    expect(n).toBeGreaterThan(0);
    // B and C should be parented to A (id 1); C is not parented to B (same level 2).
    const parentUpdates = ups.filter((c) => c.sql.includes("SET parent_id"));
    expect(parentUpdates).toHaveLength(2);
    expect(parentUpdates.map((c) => c.values)).toEqual([[1, 2], [1, 3]]);
  });
});