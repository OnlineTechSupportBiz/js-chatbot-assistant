"use client";

import Link from "next/link";
import { useFetch } from "@/components/hooks";
import { DateTime } from "@/components/timezone";

interface Lead {
  id: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  summary: string | null;
  chatbot_id: number;
  chatbot_name: string;
  captured_at: string;
}

export default function LeadsPage() {
  const { data, error, loading } = useFetch<Lead[]>("/api/admin/leads");

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Leads</h1>
          <p className="subtitle">Contact details your chatbots have captured.</p>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <p className="muted">Loading...</p>
      ) : !data || data.length === 0 ? (
        <div className="empty">No leads captured yet.</div>
      ) : (
        <div className="card card-flush">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Chatbot</th>
                <th>Captured</th>
              </tr>
            </thead>
            <tbody>
              {data.map((l) => (
                <tr key={l.id}>
                  <td>{l.name ?? "-"}</td>
                  <td>{l.email ? <a href={`mailto:${l.email}`}>{l.email}</a> : "-"}</td>
                  <td>{l.phone ?? "-"}</td>
                  <td>
                    <Link href={`/chatbots/${l.chatbot_id}`}>{l.chatbot_name}</Link>
                  </td>
                  <td className="muted"><DateTime value={l.captured_at} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}