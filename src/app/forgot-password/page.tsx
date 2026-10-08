"use client";

import { useEffect, useState } from "react";

const BRAND = "Chatbot Assistant";

export default function ForgotPasswordPage() {
  const [csrf, setCsrf] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
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
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: fd.get("email"), _csrf: csrf }),
      });
      if (res.ok) {
        setError("");
        setNotice("If an account exists, we have emailed you a password reset link.");
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Could not send the reset link. Please try again.");
      }
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
        <h1>Forgot Password</h1>
        <p className="auth-subtitle">Enter your email and we will send you a reset link.</p>

        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <div className="alert alert-success" role="alert">
            {notice}
          </div>
        )}

        <form onSubmit={submit}>
          <div className="field">
            <label className="label" htmlFor="email">
              Email
            </label>
            <input className="input" id="email" name="email" type="email" required autoComplete="email" />
          </div>
          <button className="btn btn-primary auth-submit" type="submit" disabled={sending}>
            {sending ? "Sending..." : "Send Reset Link"}
          </button>
        </form>

        <div className="auth-center muted">
          <a href="/login">Back to sign in</a>
        </div>
      </div>
    </div>
  );
}