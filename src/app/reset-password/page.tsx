"use client";

import { useEffect, useState } from "react";

const BRAND = "Chatbot Assistant";

export default function ResetPasswordPage() {
  const [csrf, setCsrf] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get("token") ?? "");
    fetch("/csrf")
      .then((r) => r.json())
      .then((d) => setCsrf(d.csrf))
      .catch(() => {});
  }, []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSending(true);
    const fd = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: fd.get("email"),
          token: fd.get("token"),
          password: fd.get("password"),
          _csrf: csrf,
        }),
      });
      const data = await res.json();
      if (data.redirect) window.location.href = data.redirect;
      else setError(data.error ?? "Could not reset your password.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card" id="main-content">
        <div className="auth-logo">
          <span className="logo-text">{BRAND}</span>
        </div>
        <h1>Reset Password</h1>

        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}

        <form onSubmit={submit}>
          <input type="hidden" name="token" value={token} />

          <div className="field">
            <label className="label" htmlFor="email">
              Email
            </label>
            <input className="input" id="email" name="email" type="email" required autoComplete="email" />
          </div>
          <div className="field">
            <label className="label" htmlFor="password">
              New Password
            </label>
            <input
              className="input"
              id="password"
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
            />
          </div>

          <button className="btn btn-primary auth-submit" type="submit" disabled={sending}>
            {sending ? "Resetting..." : "Reset Password"}
          </button>
        </form>
      </div>
    </div>
  );
}