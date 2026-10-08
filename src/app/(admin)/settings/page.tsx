"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useFetch, useCsrf } from "@/components/hooks";
import { ReindexProgress } from "@/components/admin/reindex-progress";
import { CostCalculator } from "@/components/admin/cost-calculator";
import type { TimezoneOption } from "@/lib/timezones";

interface LlmModelSettings {
  name: string;
  base_url: string;
  api_key_hint: string | null;
  model: string;
}

interface Settings {
  // Account card (read-only display, mirrors the PHP settings page).
  user_name: string;
  user_email: string;
  company_name: string | null;
  user_role: "admin" | "user";
  mfa_enabled: boolean;
  brand_name: string;
  timezone: string;
  timezones: TimezoneOption[];
  llamacloud_api_key_hint: string | null;
  embedding_base_url: string | null;
  embedding_api_key_hint: string | null;
  embedding_model: string | null;
  llm_models: LlmModelSettings[];
}

interface ModelDraft {
  name: string;
  base_url: string;
  model: string;
  api_key: string;
  hint: string;
}

const EMBEDDING_MODELS = ["text-embedding-3-small", "text-embedding-3-large"];

export default function SettingsPage() {
  const router = useRouter();
  const { data, error, loading, refresh } = useFetch<Settings>("/api/admin/settings");
  const csrf = useCsrf();
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [models, setModels] = useState<ModelDraft[]>([]);

  useEffect(() => {
    if (data) {
      setModels(data.llm_models.map((m) => ({ name: m.name, base_url: m.base_url, model: m.model, api_key: "", hint: m.api_key_hint ?? "" })));
    }
  }, [data]);

  function updateModel(i: number, patch: Partial<ModelDraft>) {
    setModels((ms) => ms.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  }
  function addModel() {
    setModels((ms) => [...ms, { name: "", base_url: "", model: "", api_key: "", hint: "" }]);
  }
  function removeModel(i: number) {
    setModels((ms) => ms.filter((_, idx) => idx !== i));
  }
  function moveModel(i: number, delta: number) {
    setModels((ms) => {
      const j = i + delta;
      if (j < 0 || j >= ms.length) return ms;
      const next = [...ms];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  /** Shared submit helper — each card posts to /api/admin/settings like PHP's per-card forms. */
  async function post(payload: Record<string, unknown>, okText: string, clear?: Array<[HTMLFormElement, string]>) {
    setMsg(null);
    setBusy(true);
    const res = await fetch("/api/admin/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, _csrf: csrf }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMsg({ kind: "err", text: (body as { error?: string }).error ?? "Could not save." });
      return;
    }
    if (clear) {
      for (const [form, name] of clear) {
        const el = form.elements.namedItem(name) as HTMLInputElement | null;
        if (el) el.value = "";
      }
    }
    setMsg({ kind: "ok", text: okText });
    refresh();
    // A brand-name change also updates the sidebar/topbar via the session, which
    // the layout re-reads — refresh the server components to pick it up now.
    router.refresh();
  }

  function saveBrandName(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    post({ brand_name: fd.get("brand_name") }, "Brand name saved.");
  }

  function saveTimezone(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    post({ timezone: fd.get("timezone") }, "Timezone saved.");
  }

  function saveProviders(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    post(
      {
        embedding_base_url: fd.get("embedding_base_url"),
        embedding_api_key: fd.get("embedding_api_key"),
        embedding_model: fd.get("embedding_model"),
        llm_models: models.map((m) => ({ name: m.name, base_url: m.base_url, model: m.model, api_key: m.api_key })),
      },
      "Provider settings saved.",
      [[e.currentTarget, "embedding_api_key"]],
    );
  }

  function saveParsingKey(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    post(
      { llamacloud_api_key: fd.get("llamacloud_api_key") },
      "Parsing key saved.",
      [[e.currentTarget, "llamacloud_api_key"]],
    );
  }

  async function disableMfa() {
    const code = window.prompt("Enter a current code from your authenticator app to confirm:");
    if (code === null) return;
    setMsg(null);
    setBusy(true);
    const res = await fetch("/settings/mfa/disable", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, _csrf: csrf }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok || !(body as { ok?: boolean }).ok) {
      setMsg({ kind: "err", text: (body as { error?: string }).error ?? "Could not disable MFA." });
      return;
    }
    setMsg({ kind: "ok", text: "Multi-factor authentication disabled." });
    refresh();
  }

  async function startMfaEnrollment() {
    setMsg(null);
    setBusy(true);
    const res = await fetch("/settings/mfa/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ _csrf: csrf }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMsg({ kind: "err", text: (body as { error?: string }).error ?? "Could not start MFA enrollment." });
      return;
    }
    // Keep it simple (PHP parity): show the secret and recovery codes as an
    // info message so the user can add them to their authenticator app.
    setMsg({
      kind: "ok",
      text: `Enrollment started. Secret: ${(body as { secret?: string }).secret ?? ""} — add it to your authenticator app, then confirm a code to finish setup.`,
    });
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="subtitle">Branding, API keys, and account preferences.</p>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {msg && <div className={`alert ${msg.kind === "ok" ? "alert-success" : "alert-error"}`}>{msg.text}</div>}

      {loading || !data ? (
        <p className="muted">Loading...</p>
      ) : (
        <>
          <div className="card">
            <h2>Account</h2>
            <div className="form-row">
              <div className="field">
                <div className="label">Name</div>
                <div className="muted">{data.user_name}</div>
              </div>
              <div className="field">
                <div className="label">Email</div>
                <div className="muted">{data.user_email}</div>
              </div>
              <div className="field">
                <div className="label">Company</div>
                <div className="muted">{data.company_name ?? ""}</div>
              </div>
              <div className="field">
                <div className="label">Role</div>
                <div className="muted">{data.user_role.charAt(0).toUpperCase() + data.user_role.slice(1)}</div>
              </div>
            </div>
          </div>

          <div className="card">
            <h2>Branding</h2>
            <p className="muted" style={{ fontSize: "0.85rem" }}>This name appears in the sidebar, page titles, and email communications.</p>
            <form onSubmit={saveBrandName}>
              <div className="field">
                <label className="label" htmlFor="brand_name">Brand name</label>
                <input className="input" id="brand_name" name="brand_name" defaultValue={data.brand_name} maxLength={255} placeholder="Your company or brand name" />
              </div>
              <div className="form-actions">
                <button type="submit" className="btn btn-primary" disabled={busy}>Save brand name</button>
              </div>
            </form>
          </div>

          <div className="card">
            <h2>Timezone</h2>
            <p className="muted" style={{ fontSize: "0.85rem" }}>All dates and times are shown in your selected timezone.</p>
            <form onSubmit={saveTimezone}>
              <div className="field">
                <label className="label" htmlFor="timezone">Timezone</label>
                <select className="select" id="timezone" name="timezone" defaultValue={data.timezone}>
                  {/*
                    Labels come from the server (PHP's own wording, e.g. "US
                    Mountain (Phoenix — no DST)"); only the IANA name is
                    submitted. The current value is listed even when the option
                    list omits it (a legacy alias such as "US/Mountain"), so
                    saving other settings never silently rewrites it.
                  */}
                  {(data.timezones.some((o) => o.value === data.timezone)
                    ? data.timezones
                    : [{ value: data.timezone, label: data.timezone }, ...data.timezones]
                  ).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-actions">
                <button type="submit" className="btn btn-primary" disabled={busy}>Save timezone</button>
              </div>
            </form>
          </div>

          <div className="card">
            <h2>Model management</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              Add one or more LLM models. The first is the primary; on a failure the app fails over to the next in the list.
              Every provider is OpenAI-compatible, so self-hosted or local servers (Ollama, LM Studio, vLLM) work the same way.
            </p>
            <form onSubmit={saveProviders}>
              <h3 style={{ margin: "1rem 0 0.5rem" }}>LLM models</h3>
              {models.length === 0 ? (
                <p className="muted" style={{ margin: 0 }} id="no-models-note">
                  No models configured yet. Add one to select it in a chatbot&apos;s settings.
                </p>
              ) : (
                models.map((m, i) => (
                  <div key={i} className="form-row model-row" style={{ marginBottom: "0.5rem" }}>
                    <div className="field">
                      <label className="label">{i === 0 ? "Name / label (primary)" : "Name / label (fallback)"}</label>
                      <input className="input" value={m.name} onChange={(e) => updateModel(i, { name: e.target.value })} placeholder={i === 0 ? "Primary" : "Fallback"} />
                    </div>
                    <div className="field">
                      <label className="label">Base URL</label>
                      <input className="input" value={m.base_url} onChange={(e) => updateModel(i, { base_url: e.target.value })} placeholder="https://api.openai.com/v1" />
                    </div>
                    <div className="field">
                      <label className="label">Model</label>
                      <input className="input" value={m.model} onChange={(e) => updateModel(i, { model: e.target.value })} placeholder="gpt-4.1-mini" />
                    </div>
                    <div className="field">
                      <label className="label">API key</label>
                      <input className="input" type="password" autoComplete="off" value={m.api_key} onChange={(e) => updateModel(i, { api_key: e.target.value })} placeholder={m.hint ? `Leave blank to keep (${m.hint})` : "Not set"} />
                    </div>
                    <div className="row model-actions" style={{ alignItems: "end" }}>
                      <button type="button" className="btn btn-sm" onClick={() => moveModel(i, -1)} disabled={i === 0} title="Move up" aria-label={`Move model ${i + 1} up`}>↑</button>
                      <button type="button" className="btn btn-sm" onClick={() => moveModel(i, 1)} disabled={i === models.length - 1} title="Move down" aria-label={`Move model ${i + 1} down`}>↓</button>
                      <button type="button" className="btn btn-sm btn-danger" onClick={() => removeModel(i)} title="Remove" aria-label={`Remove model ${i + 1}`}>×</button>
                    </div>
                  </div>
                ))
              )}
              <div className="form-actions" style={{ marginTop: "0.5rem" }}>
                <button type="button" className="btn" onClick={addModel}>Add model</button>
              </div>

              <h3 style={{ margin: "1.25rem 0 0.5rem" }}>Embeddings</h3>
              <p className="muted" style={{ marginTop: 0 }}>Falls back to a configured LLM provider, then to OpenAI, when left blank.</p>
              <div className="form-row">
                <div className="field">
                  <label className="label" htmlFor="embedding_base_url">Base URL</label>
                  <input
                    className="input"
                    id="embedding_base_url"
                    name="embedding_base_url"
                    defaultValue={data.embedding_base_url ?? ""}
                    placeholder="https://api.openai.com/v1"
                  />
                </div>
                <div className="field">
                  <label className="label" htmlFor="embedding_api_key">API key</label>
                  <input
                    className="input"
                    id="embedding_api_key"
                    name="embedding_api_key"
                    type="password"
                    autoComplete="off"
                    placeholder={data.embedding_api_key_hint ?? "Not set"}
                  />
                </div>
                <div className="field">
                  <label className="label" htmlFor="embedding_model">Model</label>
                  <input
                    className="input"
                    id="embedding_model"
                    name="embedding_model"
                    list="embedding-models"
                    defaultValue={data.embedding_model ?? ""}
                    placeholder="text-embedding-3-small"
                  />
                  <datalist id="embedding-models">
                    {EMBEDDING_MODELS.map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                </div>
              </div>
              <div className="alert alert-warning" style={{ marginTop: "0.75rem" }} role="alert">
                Changing the embedding model or base URL re-embeds all of your documents in the background. Existing documents
                keep working against the new model once the re-index finishes, but freshly uploaded documents are re-indexed
                with whatever is set here.
              </div>

              <div className="form-actions">
                <button type="submit" className="btn btn-primary" disabled={busy}>Save provider settings</button>
              </div>
            </form>
          </div>

          <ReindexProgress />

          <div className="card">
            <h2>Document parsing</h2>
            <form onSubmit={saveParsingKey}>
              <div className="field">
                <label className="label" htmlFor="llamacloud_api_key">LlamaCloud API key</label>
                <input
                  className="input"
                  id="llamacloud_api_key"
                  name="llamacloud_api_key"
                  type="password"
                  autoComplete="off"
                  placeholder={data.llamacloud_api_key_hint ?? "Not set"}
                />
                <div className="muted" style={{ fontSize: "0.8rem" }}>
                  Used to parse uploaded documents before indexing. Leave blank to keep the current key.
                </div>
              </div>
              <div className="form-actions">
                <button type="submit" className="btn btn-primary" disabled={busy}>Save parsing key</button>
              </div>
            </form>
          </div>

          <CostCalculator />

          <div className="card">
            <h2>Multi-factor authentication</h2>
            {data.mfa_enabled ? (
              <>
                <div className="row" style={{ marginBottom: "0.75rem" }}>
                  <span className="badge badge-success">Enabled</span>
                  <span className="muted">Authenticator app is configured.</span>
                </div>
                <button type="button" className="btn btn-danger" onClick={disableMfa} disabled={busy}>Disable MFA</button>
              </>
            ) : (
              <>
                <p className="muted">Add an extra layer of security to your account.</p>
                <button type="button" className="btn btn-primary" onClick={startMfaEnrollment} disabled={busy}>Enable MFA</button>
              </>
            )}
          </div>

          <div className="card">
            <h2>Audit log</h2>
            <p className="muted">Review all changes made to your tenant — API key updates, user logins, chatbot changes, and more.</p>
            <a href="/audit" className="btn btn-primary">View audit log</a>
          </div>
        </>
      )}
    </>
  );
}
