import type { DbClient } from "@/lib/db";
import {
  deleteByDocument,
  insertPageIndexBatch,
  setPageIndexParent,
  type PageIndexNodeType,
} from "@/repository/document-page-index";

/**
 * PageIndexBuilder — port of PHP `Service/PageIndexBuilder`: parses markdown into
 * a hierarchical section tree and stores it as document_page_index nodes.
 */

export interface Section {
  heading: string;
  level: number;
  content: string;
}

/** PHP determineNodeType: level 1 → section, 2 → subsection, 3+ → leaf. */
export function nodeTypeFor(level: number): PageIndexNodeType {
  if (level === 1) return "section";
  if (level === 2) return "subsection";
  return "leaf";
}

/**
 * Split markdown into sections at heading lines. Ports PHP `parseSections`,
 * including its quirk: the content of every INTERMEDIATE section drops its first
 * line (only the last section keeps full trailing text). Verified against PHP.
 */
export function parseSections(text: string): Section[] {
  const headingRe = /^(#{1,6})\s+(.+?)(?:\s+#+)?$/gm;
  const matches = [...text.matchAll(headingRe)];
  if (matches.length === 0) return [];

  const sections: Section[] = [];
  let prevHeading: string | null = null;
  let prevLevel = 0;
  let prevHeadingEnd = -1; // index just past the previous heading's line

  for (const match of matches) {
    const level = match[1].length;
    const heading = match[2].trim();
    const lineStart = match.index ?? 0;
    const lineEnd = text.indexOf("\n", lineStart);

    if (prevHeading !== null) {
      const region = text.slice(prevHeadingEnd, lineStart);
      const firstNl = region.indexOf("\n");
      const content = firstNl === -1 ? "" : region.slice(firstNl + 1);
      sections.push({ heading: prevHeading, level: prevLevel, content: content.trim() });
    }

    prevHeading = heading;
    prevLevel = level;
    prevHeadingEnd = lineEnd === -1 ? text.length : lineEnd + 1;
  }

  // Last section keeps its full trailing text (no first-line drop).
  if (prevHeading !== null) {
    sections.push({ heading: prevHeading, level: prevLevel, content: text.slice(prevHeadingEnd).trim() });
  }

  return sections;
}

async function setParentRelations(db: DbClient, ids: number[], sections: Section[]): Promise<void> {
  const stack: Array<{ node_id: number; level: number }> = [];
  for (let i = 0; i < sections.length; i++) {
    const nodeId = ids[i];
    if (nodeId == null) continue;
    while (stack.length > 0 && stack[stack.length - 1].level >= sections[i].level) {
      stack.pop();
    }
    if (stack.length > 0) {
      await setPageIndexParent(db, nodeId, stack[stack.length - 1].node_id);
    }
    stack.push({ node_id: nodeId, level: sections[i].level });
  }
}

/** Build + store a PageIndex tree; returns the number of nodes created. */
export async function buildPageIndex(db: DbClient, adminId: number, chatbotId: number, documentId: number, parsedText: string): Promise<number> {
  await deleteByDocument(db, documentId);
  const text = parsedText.trim();
  if (text === "") return 0;

  const sections = parseSections(text);
  if (sections.length === 0) {
    // No headings at all — treat the whole document as a single root node.
    const ids = await insertPageIndexBatch(db, adminId, chatbotId, documentId, [
      { parent_id: null, node_type: "root", heading: null, heading_level: null, content: text, node_order: 0 },
    ]);
    return ids.length;
  }

  const nodes = sections.map((section, i) => ({
    parent_id: null,
    node_type: nodeTypeFor(section.level),
    heading: section.heading,
    heading_level: section.level,
    content: section.content,
    node_order: i,
  }));
  const ids = await insertPageIndexBatch(db, adminId, chatbotId, documentId, nodes);
  if (ids.length === 0) return 0;

  await setParentRelations(db, ids, sections);
  return ids.length;
}