"use client";

import { useCallback, useEffect, useState } from "react";
import { useCsrf } from "@/components/hooks";

interface DocStatus {
  document_id: number;
  name: string;
  status: "queued" | "processing" | "completed" | "failed";
  error_message: string | null;
}

interface ReindexStatus {
  batchId: string | null;
  total: number;
  completed: number;
  failed: number;
  queued: number;
  processing: number;
  inProgress: boolean;
  documents: DocStatus[];
}

function statusBadge(status: DocStatus["status"]) {
  if (status === "completed") return <span className="badge badge-success">Done</span>;
  if (status === "failed") return <span className="badge badge-danger">Failed</span>;
  if (status === "processing") return <span className="badge badge-warning">Processing</span>;
  return <span className="badge">Queued</span>;
}

/** Live re-embed progress for the current admin's most recent embedding-model change. */
export function ReindexProgress() {
  const csrf = useCsrf();
  const [status, setStatus] = useState<ReindexStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [rerunMsg, setRerunMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/reindex");
      if (res.ok) setStatus((await res.json()) as ReindexStatus);
    } catch {
      // transient network error — ignore, the next poll retries
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [load]);

  async function rerun() {
    setBusy(true);
    setRerunMsg(null);
    try {
      const res = await fetch("/api/admin/reindex", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ _csrf: csrf }),
      });
      const body = await res.json();
      if (res.ok) {
        setRerunMsg(`Re-queued ${(body as { count?: number }).count ?? 0} document(s).`);
        await load();
      } else {
        setRerunMsg((body as { error?: string }).error ?? "Could not rerun.");
      }
    } catch {
      setRerunMsg("Could not rerun.");
    } finally {
      setBusy(false);
    }
  }

  if (!status || !status.batchId) return null;

  const done = status.completed + status.failed;
  const pct = status.total ? Math.round((done / status.total) * 100) : 0;

  return (
    <div className="card">
      <h2>Reindex progress</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        {status.inProgress
          ? `Reindexing ${status.total} document${status.total === 1 ? "" : "s"} (${status.completed} done, ${status.processing} in progress).`
          : `Reindex complete: ${status.completed} of ${status.total} done${status.failed ? `, ${status.failed} failed` : ""}.`}
      </p>
      <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="muted" style={{ fontSize: "0.8rem", marginTop: "0.35rem" }}>
        {pct}% ({done}/{status.total})
      </div>

      {status.documents.length > 0 && (
        <ul className="reindex-list">
          {status.documents.map((d) => (
            <li key={d.document_id}>
              <span>{d.name}</span>
              {statusBadge(d.status)}
              {d.status === "failed" && d.error_message && <span className="reindex-error">{d.error_message}</span>}
            </li>
          ))}
        </ul>
      )}

      {status.failed > 0 && (
        <div className="form-actions">
          <button type="button" className="btn" onClick={rerun} disabled={busy}>
            {busy ? "Re-queuing..." : "Rerun failed documents"}
          </button>
        </div>
      )}
      {rerunMsg && (
        <div className="muted" style={{ fontSize: "0.8rem", marginTop: "0.5rem" }}>
          {rerunMsg}
        </div>
      )}
    </div>
  );
}