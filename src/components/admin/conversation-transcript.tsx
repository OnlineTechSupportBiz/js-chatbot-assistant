"use client";

/**
 * Conversation transcript — a port of the PHP `conversation_detail.php` /
 * `chatbots/show.php` transcript markup, so a session reads the same in either
 * backend: role-coloured avatar disc, uppercase role label, retrieval-source
 * badge, markdown body, and a meta line (time / tokens / response time), with a
 * date separator whenever the calendar day changes.
 *
 * Markdown + sanitising is the PHP pipeline too (`marked` then `DOMPurify`),
 * because the stored content is raw by design: `Message.content` holds exactly
 * what the visitor typed or the model produced, and sanitising happens at output
 * time (PHP `MessageSanitizationTest` asserts the same). Both steps are required:
 *
 *   1. `escapeHtml` FIRST — `marked.parse()` passes raw HTML straight through, so
 *      without escaping a reply lands in the admin page as live HTML and script.
 *      Markdown still renders; literal HTML in a reply does not.
 *   2. `DOMPurify.sanitize` SECOND — markdown can still build a link with a
 *      dangerous scheme (`[x](javascript:...)`) that `marked` does not filter.
 *
 * Step 1 also means blockquote syntax (`> `) renders literally. That is the same
 * trade-off the PHP view makes, and the same one the widget makes.
 */

import { useEffect, useMemo, useState } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { EMPTY_DATETIME, formatDayKey, formatLongDate, formatTime } from "@/lib/datetime";
import { useTimezone } from "@/components/timezone";

export interface TranscriptMessage {
  id: number;
  role: string;
  content: string;
  source: string | null;
  tokens_used: number | null;
  response_time_ms: number | null;
  created_at: string;
}

/** Escape HTML metacharacters before the text reaches `marked`. */
export function escapeHtml(text: string): string {
  return String(text === null || text === undefined ? "" : text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escape, render markdown, then strip anything executable. Never throws. */
export function renderMarkdown(raw: string): string {
  try {
    return DOMPurify.sanitize(marked.parse(escapeHtml(raw), { breaks: true, gfm: true }) as string);
  } catch {
    // PHP falls back to the escaped server-rendered text for the same reason.
    return escapeHtml(raw).replace(/\n/g, "<br>");
  }
}

/** PHP: `ucfirst($msg['role'])` with the avatar initial `strtoupper($role[0])`. */
function roleLabel(role: string): string {
  const r = role.toLowerCase();
  return r.charAt(0).toUpperCase() + r.slice(1);
}

function roleInitial(role: string): string {
  return (role.charAt(0) || "?").toUpperCase();
}

/** PHP `str_replace('_', ' ', $source)` — "quick_answer" -> "quick answer". */
function sourceLabel(source: string): string {
  return source.replace(/_/g, " ");
}

export function ConversationTranscript({ messages }: { messages: TranscriptMessage[] }) {
  const timeZone = useTimezone();

  // Rendered HTML is computed once per message (pure function of `content`) and
  // only after mount, so `DOMPurify` — which needs a DOM — never runs during SSR.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const html = useMemo(
    () => (mounted ? messages.map((m) => renderMarkdown(m.content)) : []),
    [messages, mounted],
  );

  // Computed from `messages` rather than accumulated in a ref DURING render: a
  // ref mutated mid-render is not idempotent, and React's StrictMode double-render
  // (next.config `reactStrictMode: true`) runs the render twice — the first pass
  // would set the "last day seen" ref and its output is then discarded, so every
  // separator after the first would vanish. Deriving it keeps the render pure.
  const rendered = messages.map((m, i) => {
    const day = formatDayKey(m.created_at, timeZone);
    const previousDay = i === 0 ? null : formatDayKey(messages[i - 1].created_at, timeZone);
    const showSeparator = day !== "" && day !== previousDay;
    return { message: m, day, showSeparator };
  });

  const out: React.ReactNode[] = [];

  rendered.forEach(({ message: m, showSeparator }, i) => {
    // Group by the day the user SEES, not the raw UTC date (PHP compares the
    // converted value too), so an evening message is not filed under tomorrow.
    const role = m.role.toLowerCase();
    const cls = role === "user" ? "user" : role === "assistant" ? "assistant" : "system";
    if (showSeparator) {
      out.push(
        <div className="msg-separator" key={`sep-${m.id}`}>
          {formatLongDate(m.created_at, timeZone)}
        </div>,
      );
    }
    out.push(
      <div key={m.id} className={`msg msg-${cls}`}>
        <div className={`msg-avatar msg-avatar-${cls}`}>{roleInitial(role)}</div>
        <div className="msg-bubble">
          <div className={`msg-meta msg-meta-${cls}`}>
            {roleLabel(role)}
            {m.source ? <span className="msg-source">{sourceLabel(m.source)}</span> : null}
          </div>
          <div
            className="msg-text"
            // Sanitised above; `dangerouslySetInnerHTML` is the only way to render
            // markdown here, and its input never contains unescaped raw HTML.
            dangerouslySetInnerHTML={{ __html: html[i] ?? "" }}
          />
          <div className="msg-detail">
            <span>{formatDayKey(m.created_at, timeZone) === "" ? EMPTY_DATETIME : formatTime(m.created_at, timeZone)}</span>
            {m.tokens_used != null ? <span title="Tokens used">{m.tokens_used} tok</span> : null}
            {m.response_time_ms != null ? (
              <span title="Response time">
                {m.response_time_ms.toLocaleString("en-US")} ms
              </span>
            ) : null}
          </div>
        </div>
      </div>,
    );
  });

  return <>{out}</>;
}