"use client";

import Link from "next/link";
import { useFetch, useCsrf } from "@/components/hooks";

interface Chatbot {
  id: number;
  name: string;
  industry: string | null;
  status: string;
  retrieval_strategy: string;
  widget_token: string;
  created_at: string;
}

export default function ChatbotsPage() {
  const { data, error, loading, refresh } = useFetch<Chatbot[]>("/api/admin/chatbots");
  const csrf = useCsrf();

  async function clone(chatbot: Chatbot) {
    const newName = window.prompt("Name for the cloned chatbot", `${chatbot.name} copy`);
    if (!newName) return;
    await fetch(`/api/admin/chatbots/${chatbot.id}/clone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ new_name: newName, _csrf: csrf }),
    });
    refresh();
  }

  async function remove(chatbot: Chatbot) {
    if (!window.confirm(`Delete "${chatbot.name}"? This permanently removes the chatbot with all of its conversations, documents, and leads.`)) return;
    const res = await fetch(`/api/admin/chatbots/${chatbot.id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ _csrf: csrf }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      window.alert((body as { error?: string }).error ?? "Could not delete the chatbot.");
      return;
    }
    refresh();
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Chatbots</h1>
          <p className="subtitle">Create and manage your customer-facing assistants.</p>
        </div>
        <Link className="btn btn-primary" href="/chatbots/new">
          New chatbot
        </Link>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <p className="muted">Loading...</p>
      ) : !data || data.length === 0 ? (
        <div className="empty">No chatbots yet. Create your first one to get started.</div>
      ) : (
        <div className="card card-flush">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Industry</th>
                <th>Status</th>
                <th>Retrieval</th>
                <th>Widget token</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/chatbots/${c.id}`}>{c.name}</Link>
                  </td>
                  <td className="muted">{c.industry ?? "-"}</td>
                  <td>
                    <span className={`badge ${c.status === "active" ? "badge-success" : ""}`}>{c.status}</span>
                  </td>
                  <td className="muted">{c.retrieval_strategy}</td>
                  <td><span className="mono">{c.widget_token}</span></td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button className="btn btn-sm" onClick={() => clone(c)}>Clone</button>{" "}
                    <button className="btn btn-sm btn-danger" onClick={() => remove(c)}>Delete</button>
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