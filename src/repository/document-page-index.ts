import type { DbClient } from "@/lib/db";

/**
 * document_page_index — port of PHP `Model/DocumentPageIndexNode`: a hierarchical
 * tree of document sections used by the vectorless PageIndex retrieval strategy.
 */

export type PageIndexNodeType = "root" | "section" | "subsection" | "leaf";

export interface PageIndexNode {
  id: number;
  admin_id: number;
  chatbot_id: number;
  document_id: number;
  parent_id: number | null;
  node_type: PageIndexNodeType;
  heading: string | null;
  heading_level: number | null;
  content: string | null;
  node_order: number;
  created_at: string;
}

export interface OutlineRow {
  id: number;
  parent_id: number | null;
  document_id: number;
  node_type: PageIndexNodeType;
  heading: string | null;
  heading_level: number | null;
  node_order: number;
}

export interface PageIndexNodeInput {
  parent_id: number | null;
  node_type: PageIndexNodeType;
  heading: string | null;
  heading_level: number | null;
  content: string | null;
  node_order: number;
}

export async function getOutlineByChatbot(db: DbClient, adminId: number, chatbotId: number): Promise<OutlineRow[]> {
  const r = await db.query(
    `SELECT id, parent_id, document_id, node_type, heading, heading_level, node_order
     FROM document_page_index
     WHERE admin_id = $1 AND chatbot_id = $2
     ORDER BY document_id, parent_id IS NOT NULL, parent_id, node_order`,
    [adminId, chatbotId],
  );
  return r.rows as OutlineRow[];
}

export async function getContentByIds(db: DbClient, adminId: number, chatbotId: number, nodeIds: number[]): Promise<Array<{ id: number; heading: string | null; content: string | null; node_type: string; document_id: number }>> {
  if (nodeIds.length === 0) return [];
  const placeholders = nodeIds.map((_, i) => `$${i + 3}`).join(",");
  const r = await db.query(
    `SELECT id, heading, content, node_type, document_id
     FROM document_page_index
     WHERE admin_id = $1 AND chatbot_id = $2 AND id IN (${placeholders})`,
    [adminId, chatbotId, ...nodeIds],
  );
  return r.rows as Array<{ id: number; heading: string | null; content: string | null; node_type: string; document_id: number }>;
}

export async function countIndexedDocumentsByChatbot(db: DbClient, adminId: number, chatbotId: number): Promise<number> {
  const r = await db.query(
    "SELECT COUNT(DISTINCT document_id) AS c FROM document_page_index WHERE admin_id = $1 AND chatbot_id = $2",
    [adminId, chatbotId],
  );
  return Number(r.rows[0]?.c ?? 0);
}

/** Insert a batch of nodes and return their IDs in insertion order. */
export async function insertPageIndexBatch(db: DbClient, adminId: number, chatbotId: number, documentId: number, nodes: PageIndexNodeInput[]): Promise<number[]> {
  if (nodes.length === 0) return [];

  const values: string[] = [];
  const params: unknown[] = [];
  nodes.forEach((node, i) => {
    const b = i * 9;
    values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9})`);
    params.push(adminId, chatbotId, documentId, node.parent_id, node.node_type, node.heading, node.heading_level, node.content, node.node_order);
  });

  const r = await db.query(
    `INSERT INTO document_page_index (admin_id, chatbot_id, document_id, parent_id, node_type, heading, heading_level, content, node_order)
     VALUES ${values.join(", ")}
     RETURNING id`,
    params,
  );
  return (r.rows as Array<{ id: number }>).map((row) => Number(row.id));
}

export async function setPageIndexParent(db: DbClient, nodeId: number, parentId: number): Promise<void> {
  await db.query("UPDATE document_page_index SET parent_id = $1 WHERE id = $2", [parentId, nodeId]);
}

export async function deleteByDocument(db: DbClient, documentId: number): Promise<void> {
  await db.query("DELETE FROM document_page_index WHERE document_id = $1", [documentId]);
}

export async function deleteByChatbot(db: DbClient, chatbotId: number): Promise<void> {
  await db.query("DELETE FROM document_page_index WHERE chatbot_id = $1", [chatbotId]);
}

export async function countByDocument(db: DbClient, documentId: number): Promise<number> {
  const r = await db.query("SELECT COUNT(*) AS c FROM document_page_index WHERE document_id = $1", [documentId]);
  return Number(r.rows[0]?.c ?? 0);
}

/** Build a nested tree (children arrays) from flat rows — PHP buildTree. */
export function buildPageIndexTree<T extends { id: number; parent_id: number | null }>(flatRows: T[]): Array<T & { children: T[] }> {
  const map = new Map<number, T & { children: T[] }>();
  for (const row of flatRows) map.set(row.id, { ...row, children: [] });
  const roots: Array<T & { children: T[] }> = [];
  for (const node of map.values()) {
    if (node.parent_id !== null && map.has(node.parent_id)) {
      map.get(node.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

/** Render a tree as an [id:N]-marked text outline — PHP renderOutline. */
export function renderOutline(nodes: Array<{ id: number; heading: string | null; heading_level: number | null; children: unknown[] }>, depth = 0): string {
  return renderOutlineLines(nodes, depth).join("\n");
}

function renderOutlineLines(nodes: Array<{ id: number; heading: string | null; heading_level: number | null; children: unknown[] }>, depth: number): string[] {
  const lines: string[] = [];
  for (const node of nodes) {
    const prefix = "  ".repeat(depth);
    const heading = node.heading ?? "(untitled)";
    // PHP quirk: the `#`-prefix is only emitted at depth 0.
    const hashPrefix = prefix === "" && node.heading_level ? "#".repeat(node.heading_level) + " " : "";
    const children = node.children as Array<{ id: number; heading: string | null; heading_level: number | null; children: unknown[] }>;
    lines.push(`${prefix}[id:${node.id}] ${hashPrefix}${heading}`);
    if (children.length > 0) {
      lines.push(...renderOutlineLines(children, depth + 1));
    }
  }
  return lines;
}