"use client";

import Link from "next/link";
import { useFetch } from "@/components/hooks";
import { DateTime } from "@/components/timezone";

interface Conversation {
  id: number;
  chatbot_id: number;
  chatbot_name: string;
  visitor_ip: string | null;
  message_count: number;
  rating: number | null;
  last_message_at: string;
}

export default function ConversationsPage() {
  const { data, error, loading } = useFetch<Conversation[]>("/api/admin/conversations");

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Conversations</h1>
          <p className="subtitle">Recent visitor conversations across all your chatbots.</p>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <p className="muted">Loading...</p>
      ) : !data || data.length === 0 ? (
        <div className="empty">No conversations yet.</div>
      ) : (
        <div className="card card-flush">
          <table className="table">
            <thead>
              <tr>
                <th>Chatbot</th>
                <th>Visitor IP</th>
                <th>Messages</th>
                <th>Rating</th>
                <th>Last message</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/chatbots/${c.chatbot_id}`}>{c.chatbot_name}</Link>
                  </td>
                  <td className="mono">{c.visitor_ip ?? "-"}</td>
                  <td>{c.message_count}</td>
                  <td>{c.rating ?? "-"}</td>
                  <td className="muted"><DateTime value={c.last_message_at} /></td>
                  <td style={{ textAlign: "right" }}>
                    <Link className="btn btn-sm" href={`/chatbots/${c.chatbot_id}/conversations/${c.id}`}>
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}