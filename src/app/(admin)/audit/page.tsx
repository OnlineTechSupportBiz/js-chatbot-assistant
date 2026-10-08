"use client";

import { useFetch } from "@/components/hooks";
import { DateTime } from "@/components/timezone";

interface AuditRow {
  id: number;
  action: string;
  entity_type: string | null;
  entity_id: number | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

interface AuditResult {
  total: number;
  rows: AuditRow[];
  page: number;
  per_page: number;
}

export default function AuditPage() {
  const { data, error, loading } = useFetch<AuditResult>("/api/admin/audit");

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Audit log</h1>
          <p className="subtitle">A record of account and admin actions.</p>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <p className="muted">Loading...</p>
      ) : !data || data.rows.length === 0 ? (
        <div className="empty">No audit entries yet.</div>
      ) : (
        <div className="card card-flush">
          <table className="table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Action</th>
                <th>Entity</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id}>
                  <td className="muted"><DateTime value={r.created_at} /></td>
                  <td>
                    <span className="mono">{r.action}</span>
                  </td>
                  <td className="muted">
                    {r.entity_type ?? "-"}
                    {r.entity_id !== null ? ` #${r.entity_id}` : ""}
                  </td>
                  <td className="mono">{r.ip_address ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="muted" style={{ padding: "0.75rem 0.9rem", fontSize: "0.82rem" }}>
            {data.total} entries total
          </div>
        </div>
      )}
    </>
  );
}