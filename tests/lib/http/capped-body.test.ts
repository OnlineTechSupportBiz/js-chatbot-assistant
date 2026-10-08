import { describe, it, expect } from "vitest";
import { readCappedBody, parseMultipartFormData } from "@/lib/http/capped-body";

/** A body delivered in chunks, with no Content-Length anywhere in sight. */
function chunkedStream(chunks: Uint8Array[], onCancel?: () => void): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(chunks[i++]);
      } else {
        controller.close();
      }
    },
    cancel() {
      onCancel?.();
    },
  });
}

const bytes = (s: string) => new TextEncoder().encode(s);

describe("readCappedBody (SEC-11)", () => {
  it("returns the concatenated body when it fits", async () => {
    const body = await readCappedBody(chunkedStream([bytes("abc"), bytes("def")]), 100);
    expect(new TextDecoder().decode(body!)).toBe("abcdef");
  });

  it("accepts a body exactly at the cap", async () => {
    const body = await readCappedBody(chunkedStream([bytes("12345")]), 5);
    expect(body).not.toBeNull();
    expect(body!.byteLength).toBe(5);
  });

  it("returns null once the cap is exceeded, without buffering the rest", async () => {
    let cancelled = false;
    const body = await readCappedBody(
      chunkedStream([bytes("12345"), bytes("67890")], () => {
        cancelled = true;
      }),
      6,
    );
    expect(body).toBeNull();
    // The stream is abandoned rather than drained: a client that streams forever
    // cannot make the server hold the bytes it sends.
    expect(cancelled).toBe(true);
  });

  it("treats a missing body as empty", async () => {
    expect((await readCappedBody(null, 10))!.byteLength).toBe(0);
  });
});

describe("parseMultipartFormData", () => {
  it("parses a multipart body from bytes that were already capped", async () => {
    const boundary = "----test-boundary";
    const raw =
      `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="_csrf"\r\n' +
      "\r\n" +
      "csrf-token-value\r\n" +
      `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="document"; filename="a.pdf"\r\n' +
      "Content-Type: application/pdf\r\n" +
      "\r\n" +
      "%PDF-1.4 fake\r\n" +
      `--${boundary}--\r\n`;

    const form = await parseMultipartFormData(
      bytes(raw),
      `multipart/form-data; boundary=${boundary}`,
    );
    expect(form.get("_csrf")).toBe("csrf-token-value");
    const file = form.get("document");
    expect(file).toBeInstanceOf(File);
    expect((file as File).name).toBe("a.pdf");
  });

  it("throws on a body whose Content-Type has no boundary", async () => {
    await expect(parseMultipartFormData(bytes("nope"), "multipart/form-data")).rejects.toThrow();
  });
});
