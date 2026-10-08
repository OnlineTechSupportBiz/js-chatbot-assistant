"use client";

/**
 * Conversation session detail.
 *
 * Layout follows the PHP `conversation_detail.php`: the visitor session id and
 * message count in the page subtitle, a lead summary strip above the
 * transcript, then the messages. The transcript itself is
 * `components/admin/conversation-transcript.tsx`, which is a direct port of the
 * PHP `.conv-*` markup.
 */

import Link from "next/link";
import { useParams } from "next/navigation";
import { useFetch } from "@/components/hooks";
import { DateTime } from "@/components/timezone";
import {
  ConversationTranscript,
  type TranscriptMessage,
} from "@/components/admin/conversation-transcript";

interface Lead {
  name: string | null;
  email: string | null;
  phone: string | null;
  summary: string | null;
}

interface Detail {
  conversation:
    | {
        id: number;
        chatbot_id: number;
        visitor_session_id: string;
        message_count: number;
        rating: number | null;
        first_message_at: string;
        last_message_at: string;
      }
    | null;
  messages: TranscriptMessage[];
  lead: Lead | null;
}

export default function ConversationDetailPage() {
  const params = useParams<{ id: string; cid: string }>();
  const { data, error, loading } = useFetch<Detail>(
    `/api/admin/chatbots/${params.id}/conversations/${params.cid}`,
  );
  const c = data?.conversation;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Conversation Session</h1>
          <p className="subtitle">
            {c ? (
              <>
                <span className="mono">{c.visitor_session_id}</span>
                {` · ${c.message_count} message${c.message_count !== 1 ? "s" : ""}`}
                {` · `}
                <DateTime value={c.first_message_at} />
                {` – `}
                <DateTime value={c.last_message_at} />
                {` · `}
                {c.rating != null ? `Rating: ${c.rating}/5` : "Rating: -/5"}
              </>
            ) : (
              <Link href={`/chatbots/${params.id}`}>Back to chatbot</Link>
            )}
          </p>
        </div>
        <div>
          <Link className="btn" href={`/chatbots/${params.id}?tab=Conversations`}>
            Back to Sessions
          </Link>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {loading ? (
        <p className="muted">Loading...</p>
      ) : !data ? null : (
        <>
          {data.lead && (
            <div className="lead-card">
              <div className="form-row">
                <div>
                  <div className="lead-label">Name</div>
                  <div className="lead-value">{data.lead.name ?? "-"}</div>
                </div>
                <div>
                  <div className="lead-label">Email</div>
                  <div className="lead-value">
                    {data.lead.email ? <a href={`mailto:${data.lead.email}`}>{data.lead.email}</a> : "-"}
                  </div>
                </div>
                <div>
                  <div className="lead-label">Phone</div>
                  <div className="lead-value">{data.lead.phone ?? "-"}</div>
                </div>
                <div>
                  <div className="lead-label">Summary</div>
                  <div className="lead-value">{data.lead.summary ?? "No summary"}</div>
                </div>
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-head">
              <h2>Messages</h2>
              <span className="badge">
                {data.messages.length} message{data.messages.length !== 1 ? "s" : ""}
              </span>
            </div>
            {data.messages.length === 0 ? (
              <p className="muted">No messages in this session.</p>
            ) : (
              <ConversationTranscript messages={data.messages} />
            )}
          </div>
        </>
      )}
    </>
  );
}