"use client";

import { useEffect, useRef, useState } from "react";
import { useFetch, useCsrf } from "@/components/hooks";
import { DateOnly } from "@/components/timezone";

interface Document {
  id: number;
  original_name: string;
  filename: string;
  status: string;
  file_size: number;
  mime_type: string;
  created_at: string;
}

interface UploadItem {
  id: string;
  name: string;
  size: number;
  progress: number;
  status: "uploading" | "done" | "error";
  error?: string;
}

function statusBadge(status: string): string {
  if (status === "indexed") return "badge badge-success";
  if (status === "failed") return "badge badge-danger";
  return "badge badge-warning";
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const ACTIVE_STATUSES = new Set(["uploaded", "queued", "parsing", "chunking", "embedding", "processing"]);
const ACCEPT = ".pdf,.doc,.docx,.txt,.md,application/pdf,text/plain,text/markdown";

export function DocumentsTab({ chatbotId }: { chatbotId: number }) {
  const { data, error, loading, refresh } = useFetch<Document[]>(`/api/admin/chatbots/${chatbotId}/documents`);
  const csrf = useCsrf();
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [processing, setProcessing] = useState(false);

  const activeCount = data?.filter((d) => ACTIVE_STATUSES.has(d.status)).length ?? 0;

  // Keep the list live while files upload or training jobs are still running.
  useEffect(() => {
    if (uploads.length === 0 && activeCount === 0) return;
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, [uploads.length, activeCount, refresh]);

  function uploadFile(file: File) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setUploads((prev) => [...prev, { id, name: file.name, size: file.size, progress: 0, status: "uploading" }]);

    const fd = new FormData();
    fd.append("document", file);
    fd.append("_csrf", csrf);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/admin/chatbots/${chatbotId}/documents`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const pct = Math.floor((e.loaded / e.total) * 100);
        setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, progress: pct } : u)));
      }
    };

    xhr.onload = () => {
      let body: { error?: string } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* non-JSON response */
      }
      const ok = xhr.status >= 200 && xhr.status < 300;
      setUploads((prev) =>
        prev.map((u) =>
          u.id === id
            ? ok
              ? { ...u, status: "done", progress: 100 }
              : { ...u, status: "error", error: body.error ?? "Upload failed." }
            : u,
        ),
      );
      // Auto-dismiss finished uploads shortly after they complete.
      if (ok) setTimeout(() => setUploads((prev) => prev.filter((u) => u.id !== id)), 4000);
      refresh();
    };

    xhr.onerror = () => {
      setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, status: "error", error: "Network error." } : u)));
      refresh();
    };

    xhr.send(fd);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) {
      setMsg(null);
      files.forEach(uploadFile);
    }
  }

  function handleSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length) {
      setMsg(null);
      files.forEach(uploadFile);
    }
    e.target.value = "";
  }

  async function remove(doc: Document) {
    if (!window.confirm(`Delete "${doc.original_name}"? Its index and chunks are removed too.`)) return;
    const res = await fetch(`/api/admin/documents/${doc.id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ _csrf: csrf }),
    });
    if (!res.ok) setMsg({ kind: "err", text: "Could not delete." });
    else refresh();
  }

  async function processNow() {
    setProcessing(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/chatbots/${chatbotId}/documents/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ _csrf: csrf }),
      });
      const body = await res.json();
      if (!res.ok) {
        setMsg({ kind: "err", text: (body as { error?: string }).error ?? "Could not process." });
      } else {
        const b = body as { completed?: number; failed?: number };
        if (b.failed) setMsg({ kind: "err", text: `Processed ${b.completed ?? 0} document(s), ${b.failed} failed.` });
        else setMsg({ kind: "ok", text: `Processed ${b.completed ?? 0} document(s).` });
      }
      refresh();
    } catch {
      setMsg({ kind: "err", text: "Could not process." });
    } finally {
      setProcessing(false);
    }
  }

  async function reprocessAll() {
    setProcessing(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/chatbots/${chatbotId}/documents/reprocess`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ _csrf: csrf }),
      });
      const body = await res.json();
      if (!res.ok) {
        setMsg({ kind: "err", text: (body as { error?: string }).error ?? "Could not reprocess." });
      } else {
        setMsg({ kind: "ok", text: `Queued ${(body as { count?: number }).count ?? 0} document(s) to reprocess from the existing store.` });
      }
      refresh();
    } catch {
      setMsg({ kind: "err", text: "Could not reprocess." });
    } finally {
      setProcessing(false);
    }
  }

  async function deleteStore() {
    if (!window.confirm("Delete the entire document store? Every stored file, index, and embedding for this chatbot will be permanently removed.")) return;
    setMsg(null);
    const res = await fetch(`/api/admin/chatbots/${chatbotId}/documents`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ _csrf: csrf }),
    });
    const body = await res.json();
    if (!res.ok) setMsg({ kind: "err", text: (body as { error?: string }).error ?? "Could not delete." });
    else setMsg({ kind: "ok", text: `Deleted ${(body as { count?: number }).count ?? 0} document(s).` });
    refresh();
  }

  return (
    <>
      {msg && <div className={`alert ${msg.kind === "ok" ? "alert-success" : "alert-error"}`}>{msg.text}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      <div className="card">
        <h2>Upload documents</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Drop PDF, DOC, DOCX, TXT, or Markdown files here, or click to browse. Up to 20 MB each. Multiple files upload at once; training runs as a background job.
        </p>
        <div
          className={`dropzone${dragging ? " dropzone-active" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              fileRef.current?.click();
            }
          }}
        >
          <div className="dropzone-label">Drag and drop files here</div>
          <div className="dropzone-hint">or click to browse</div>
          <input ref={fileRef} type="file" multiple accept={ACCEPT} hidden onChange={handleSelect} />
        </div>

        {uploads.length > 0 && (
          <ul className="upload-list">
            {uploads.map((u) => (
              <li key={u.id} className="upload-item">
                <span className="upload-name" title={u.name}>
                  {u.name}
                </span>
                {u.status === "uploading" ? (
                  <>
                    <progress className="upload-progress" value={u.progress} max={100} aria-label={`${u.name} upload progress`} />
                    <span className="upload-pct">{u.progress}%</span>
                  </>
                ) : u.status === "done" ? (
                  <span className="badge badge-success">Uploaded</span>
                ) : (
                  <>
                    <span className="badge badge-danger">Failed</span>
                    <button type="button" className="btn btn-sm" onClick={() => setUploads((prev) => prev.filter((x) => x.id !== u.id))}>
                      Dismiss
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card card-flush">
        <div className="card-head">
          <h2>Documents</h2>
          <div className="row">
            <button type="button" className="btn btn-sm" onClick={processNow} disabled={processing}>
              {processing ? "Processing..." : "Process now"}
            </button>
            <button type="button" className="btn btn-sm" onClick={reprocessAll} disabled={processing}>
              Reprocess all
            </button>
            <button type="button" className="btn btn-sm btn-danger" onClick={deleteStore}>
              Delete store
            </button>
          </div>
        </div>
        {loading ? (
          <p className="muted card-note">Loading...</p>
        ) : !data || data.length === 0 ? (
          <p className="muted card-note">No documents uploaded yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>File</th>
                <th>Status</th>
                <th>Size</th>
                <th>Uploaded</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.id}>
                  <td>{d.original_name}</td>
                  <td><span className={statusBadge(d.status)}>{d.status}</span></td>
                  <td className="muted">{formatSize(d.file_size)}</td>
                  <td className="muted"><DateOnly value={d.created_at} /></td>
                  <td style={{ textAlign: "right" }}>
                    <button className="btn btn-sm btn-danger" onClick={() => remove(d)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}