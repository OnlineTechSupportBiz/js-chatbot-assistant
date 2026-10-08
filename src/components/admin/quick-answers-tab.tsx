"use client";

import { useState } from "react";
import { useFetch, useCsrf } from "@/components/hooks";

interface QuickAnswer {
  id: number;
  trigger: string;
  answer: string;
  priority: number;
  is_active: number;
}

export function QuickAnswersTab({ chatbotId }: { chatbotId: number }) {
  const { data, error, loading, refresh } = useFetch<QuickAnswer[]>(`/api/admin/chatbots/${chatbotId}/quick-answers`);
  const csrf = useCsrf();
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    try {
      const res = await fetch(`/api/admin/chatbots/${chatbotId}/quick-answers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trigger: fd.get("trigger"), answer: fd.get("answer"), _csrf: csrf }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setMsg({ kind: "err", text: (body as { error?: string } | null)?.error ?? `Could not add (error ${res.status}).` });
        return;
      }
      setCreating(false);
      form.reset();
      setMsg({ kind: "ok", text: "Quick answer added." });
      refresh();
    } catch {
      setMsg({ kind: "err", text: "Could not reach the server. Check your connection and try again." });
    }
  }

  async function update(e: React.FormEvent<HTMLFormElement>, id: number) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    try {
      const res = await fetch(`/api/admin/chatbots/${chatbotId}/quick-answers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trigger: fd.get("trigger"),
          answer: fd.get("answer"),
          is_active: fd.get("is_active") === "1",
          _csrf: csrf,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setMsg({ kind: "err", text: (body as { error?: string } | null)?.error ?? `Could not save (error ${res.status}).` });
        return;
      }
      setEditingId(null);
      setMsg({ kind: "ok", text: "Quick answer saved." });
      refresh();
    } catch {
      setMsg({ kind: "err", text: "Could not reach the server. Check your connection and try again." });
    }
  }

  async function remove(qa: QuickAnswer) {
    if (!window.confirm(`Delete this quick answer?`)) return;
    const res = await fetch(`/api/admin/chatbots/${chatbotId}/quick-answers/${qa.id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ _csrf: csrf }),
    });
    if (!res.ok) setMsg({ kind: "err", text: "Could not delete." });
    else refresh();
  }

  async function move(items: QuickAnswer[], index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= items.length) return;
    const reordered = [...items];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(target, 0, moved);
    await fetch(`/api/admin/chatbots/${chatbotId}/quick-answers/reorder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: JSON.stringify(reordered.map((q) => q.id)), _csrf: csrf }),
    });
    refresh();
  }

  return (
    <>
      {msg && <div className={`alert ${msg.kind === "ok" ? "alert-success" : "alert-error"}`}>{msg.text}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      <div className="spread" style={{ marginBottom: "0.75rem" }}>
        <h2 style={{ margin: 0 }}>Quick answers</h2>
        {!creating && (
          <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>Add</button>
        )}
      </div>

      {creating && (
        <div className="card">
          <form onSubmit={create}>
            <div className="field">
              <label className="label">Trigger phrase</label>
              <input className="input" name="trigger" required placeholder="e.g. what are your hours" />
            </div>
            <div className="field">
              <label className="label">Answer</label>
              <textarea className="textarea" name="answer" required />
            </div>
            <div className="form-actions">
              <button type="submit" className="btn btn-primary btn-sm">Save</button>
              <button type="button" className="btn btn-sm" onClick={() => setCreating(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <p className="muted">Loading...</p>
      ) : !data || data.length === 0 ? (
        <div className="empty">No quick answers yet. They answer common questions without an LLM call.</div>
      ) : (
        <div className="card card-flush">
          <table className="table">
            <thead>
              <tr>
                <th>Trigger</th>
                <th>Answer</th>
                <th>Order</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.map((qa, i) =>
                editingId === qa.id ? (
                  <tr key={qa.id}>
                    <td colSpan={4}>
                      <form onSubmit={(e) => update(e, qa.id)}>
                        <div className="field">
                          <input className="input" name="trigger" defaultValue={qa.trigger} required />
                        </div>
                        <div className="field">
                          <textarea className="textarea" name="answer" defaultValue={qa.answer} required />
                        </div>
                        {/* PHP's edit form has this Active selector; without it a saved
                            answer silently dropped off the widget (is_active → 0). */}
                        <div className="field">
                          <label className="label" htmlFor={`qa-active-${qa.id}`}>Active</label>
                          <select className="select" id={`qa-active-${qa.id}`} name="is_active" defaultValue={String(qa.is_active)}>
                            <option value="1">Yes</option>
                            <option value="0">No</option>
                          </select>
                        </div>
                        <div className="form-actions" style={{ marginTop: 0 }}>
                          <button type="submit" className="btn btn-primary btn-sm">Save</button>
                          <button type="button" className="btn btn-sm" onClick={() => setEditingId(null)}>Cancel</button>
                        </div>
                      </form>
                    </td>
                  </tr>
                ) : (
                  <tr key={qa.id}>
                    <td>
                      <span className="mono">{qa.trigger}</span>{" "}
                      {!qa.is_active && <span className="badge">inactive</span>}
                    </td>
                    <td className="muted">{qa.answer}</td>
                    <td>
                      <div className="row" style={{ gap: "0.25rem" }}>
                        <button className="btn btn-sm" disabled={i === 0} onClick={() => move(data, i, -1)}>↑</button>
                        <button className="btn btn-sm" disabled={i === data.length - 1} onClick={() => move(data, i, 1)}>↓</button>
                      </div>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button className="btn btn-sm" onClick={() => setEditingId(qa.id)}>Edit</button>{" "}
                      <button className="btn btn-sm btn-danger" onClick={() => remove(qa)}>Delete</button>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}