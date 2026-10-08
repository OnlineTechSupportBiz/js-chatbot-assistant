/**
 * ChunkingService — port of PHP `Service/ChunkingService`.
 * Splits parsed text into overlapping chunks (default 500 chars / 50 overlap),
 * word-aware, using Unicode code-point offsets to match PHP's mb_* functions.
 */

export interface TextChunk {
  chunk_index: number;
  chunk_text: string;
}

const cps = (s: string): string[] => [...s];

export function chunk(text: string, size = 500, overlap = 50): TextChunk[] {
  const cp = cps(text);
  const textLength = cp.length;
  const chunks: TextChunk[] = [];
  if (textLength === 0) return chunks;

  let start = 0;
  let index = 0;

  while (start < textLength) {
    let endPos = start + size;
    let chunkCp = cp.slice(start, endPos);

    if (endPos < textLength) {
      const lastSpace = chunkCp.lastIndexOf(" ");
      if (lastSpace !== -1 && lastSpace > size / 2) {
        chunkCp = cp.slice(start, start + lastSpace);
        endPos = start + lastSpace;
      }
    }

    chunks.push({ chunk_index: index, chunk_text: chunkCp.join("") });
    start = Math.max(endPos - overlap, start + 1);
    index++;
  }

  return chunks;
}

export function chunkByParagraphs(text: string, maxChars = 1000): TextChunk[] {
  const paragraphs = text.split(/\n\s*\n/);
  const chunks: TextChunk[] = [];
  let buffer = "";
  let index = 0;

  for (let para of paragraphs) {
    para = para.trim();
    if (para === "") continue;

    // A single paragraph exceeding maxChars is split with the standard method.
    if (cps(para).length > maxChars) {
      if (buffer !== "") {
        chunks.push({ chunk_index: index++, chunk_text: buffer });
        buffer = "";
      }
      const subChunks = chunk(para, maxChars, Math.trunc(maxChars * 0.1));
      for (const sc of subChunks) {
        chunks.push({ chunk_index: index++, chunk_text: sc.chunk_text });
      }
      continue;
    }

    const candidate = buffer === "" ? para : `${buffer}\n\n${para}`;
    if (cps(candidate).length > maxChars && buffer !== "") {
      chunks.push({ chunk_index: index++, chunk_text: buffer });
      buffer = para;
    } else {
      buffer = candidate;
    }
  }

  if (buffer !== "") {
    chunks.push({ chunk_index: index++, chunk_text: buffer });
  }

  return chunks;
}