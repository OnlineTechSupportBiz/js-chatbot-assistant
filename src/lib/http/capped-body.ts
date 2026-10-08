/**
 * Read a request body with a hard byte cap (SEC-11).
 *
 * `Request.formData()` and `Request.arrayBuffer()` buffer the whole payload before
 * the handler can look at it, so a `Content-Length` check only protects against
 * clients that declare their size honestly. A chunked-encoding request, or one
 * that simply lies, is materialised in memory first — and on an instance shared
 * by every tenant, that is a denial of service against all of them.
 *
 * Reading the stream here means the cap is enforced by the code that allocates,
 * not by the header the client chose to send.
 */

/** Read the stream, returning the bytes or `null` the moment `cap` is exceeded. */
export async function readCappedBody(
  body: ReadableStream<Uint8Array> | null,
  cap: number,
): Promise<Uint8Array | null> {
  if (body === null) return new Uint8Array(0);

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      total += value.byteLength;
      if (total > cap) {
        // Stop reading and release the stream: the rest of the body is never
        // buffered, so a lying or chunked client cannot force the allocation.
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* already released or cancelled */
    }
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Parse `multipart/form-data` from bytes that were already read under a cap.
 * The original Content-Type header must be passed through, since it carries the
 * multipart boundary.
 */
export async function parseMultipartFormData(
  bytes: Uint8Array,
  contentType: string | null,
): Promise<FormData> {
  const headers = new Headers();
  if (contentType) headers.set("content-type", contentType);
  return await new Response(bytes as unknown as BodyInit, { headers }).formData();
}
