"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useFetch } from "@/components/hooks";
import { DateTime } from "@/components/timezone";
import { SettingsForm, type ChatbotDetail } from "@/components/admin/settings-form";
import { DocumentsTab } from "@/components/admin/documents-tab";
import { QuickAnswersTab } from "@/components/admin/quick-answers-tab";

const TABS = ["Settings", "Documents", "Quick answers", "Leads", "Conversations"] as const;
type Tab = (typeof TABS)[number];

interface Lead {
  id: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  summary: string | null;
  captured_at: string;
}

interface ConvRow {
  id: number;
  visitor_ip: string | null;
  message_count: number;
  rating: number | null;
  last_message_at: string;
  last_message_content?: string | null;
}

function LeadsTab({ chatbotId }: { chatbotId: number }) {
  const { data, error, loading } = useFetch<Lead[]>(`/api/admin/chatbots/${chatbotId}/leads`);
  if (loading) return <p className="muted">Loading...</p>;
  if (error) return <div className="alert alert-error">{error}</div>;
  if (!data || data.length === 0) return <div className="empty">No leads captured yet.</div>;
  return (
    <div className="card card-flush">
      <table className="table">
        <thead>
          <tr><th>Name</th><th>Email</th><th>Phone</th><th>Captured</th></tr>
        </thead>
        <tbody>
          {data.map((l) => (
            <tr key={l.id}>
              <td>{l.name ?? "-"}</td>
              <td>{l.email ?? "-"}</td>
              <td>{l.phone ?? "-"}</td>
              <td className="muted"><DateTime value={l.captured_at} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ConversationsTab({ chatbotId }: { chatbotId: number }) {
  const { data, error, loading } = useFetch<ConvRow[]>(`/api/admin/chatbots/${chatbotId}/conversations`);
  if (loading) return <p className="muted">Loading...</p>;
  if (error) return <div className="alert alert-error">{error}</div>;
  if (!data || data.length === 0) return <div className="empty">No conversations yet.</div>;
  return (
    <div className="card card-flush">
      <table className="table">
        <thead>
          <tr>
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
              <td className="mono">{c.visitor_ip ?? "-"}</td>
              <td>{c.message_count}</td>
              <td>{c.rating ?? "-"}</td>
              <td>
                <div className="muted" style={{ fontSize: "0.82rem" }}><DateTime value={c.last_message_at} /></div>
                {c.last_message_content ? <div style={{ fontSize: "0.85rem", maxWidth: 440 }}>{c.last_message_content}</div> : null}
              </td>
              {/* PHP has a "View" button here too (conversations.php:118). Without it
                  the transcript page is unreachable from the chatbot's own tab. */}
              <td style={{ textAlign: "right" }}>
                <Link className="btn btn-sm" href={`/chatbots/${chatbotId}/conversations/${c.id}`}>
                  View
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ChatbotDetailPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const id = params.id;
  const { data: chatbot, error, loading, refresh } = useFetch<ChatbotDetail>(`/api/admin/chatbots/${id}`);
  // The tab is readable from the URL so "Back to Sessions" on a transcript can
  // land on the Conversations tab, not the default Settings one. Anything else (or
  // nothing) falls back to Settings.
  const requested = searchParams.get("tab");
  const initialTab: Tab = TABS.includes(requested as Tab) ? (requested as Tab) : "Settings";
  const [tab, setTab] = useState<Tab>(initialTab);
  // Mirror the active tab into the URL with `replace`, never `push`: switching tabs
  // is not history the Back button should walk through, and `replace` keeps the
  // entry the user arrived on as the one they go back to.
  useEffect(() => {
    const next = new URLSearchParams(searchParams.toString());
    if (tab === "Settings") next.delete("tab");
    else next.set("tab", tab);
    const target = next.toString() ? `${pathname}?${next}` : pathname;
    if (target !== `${pathname}${searchParams.toString() ? `?${searchParams}` : ""}`) {
      router.replace(target, { scroll: false });
    }
  }, [pathname, router, searchParams, tab]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{chatbot?.name ?? "Chatbot"}</h1>
          <p className="subtitle">
            Widget token: <span className="mono">{chatbot?.widget_token ?? ""}</span>
          </p>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {/* Only the first load gets a placeholder. Refreshing after a save must not
          unmount the form, or the confirmation message it just set is destroyed
          (and any error message with it). */}
      {loading && !chatbot ? (
        <p className="muted">Loading...</p>
      ) : !chatbot ? null : (
        <>
          <div className="tab-bar">
            {TABS.map((t) => (
              <button key={t} className={`tab ${tab === t ? "tab-active" : ""}`} onClick={() => setTab(t)}>
                {t}
              </button>
            ))}
          </div>

          {tab === "Settings" && <SettingsForm chatbot={chatbot} onSaved={refresh} />}
          {tab === "Documents" && <DocumentsTab chatbotId={Number(id)} />}
          {tab === "Quick answers" && <QuickAnswersTab chatbotId={Number(id)} />}
          {tab === "Leads" && <LeadsTab chatbotId={Number(id)} />}
          {tab === "Conversations" && <ConversationsTab chatbotId={Number(id)} />}
        </>
      )}
    </>
  );
}