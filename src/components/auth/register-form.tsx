"use client";

import { useEffect, useState } from "react";

const BRAND = "Chatbot Assistant";

/**
 * Registration form. The page wrapper (`app/register/page.tsx`) is a server
 * component that redirects to /login when `ALLOW_REGISTRATION` is off, because
 * the flag lives in the environment and cannot be read from a client component.
 */
export function RegisterForm() {
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
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company: fd.get("company"),
          name: fd.get("name"),
          email: fd.get("email"),
          password: fd.get("password"),
          _csrf: csrf,
        }),
      });
      const data = await res.json();
      // Signup no longer signs you in: the address has to be confirmed first, so
      // show what to do next instead of bouncing straight to the dashboard.
      if (data.verify) setNotice(data.message ?? "Check your inbox to confirm your email address, then sign in.");
      else if (data.redirect) window.location.href = data.redirect;
      else setError(data.error ?? "Registration failed.");
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
        <h1>Create Your Account</h1>
        <p className="auth-subtitle">Start your Chat Assistant in minutes.</p>

        {notice && (
          <div className="alert alert-success" role="status">
            {notice}
          </div>
        )}

        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}

        <form onSubmit={submit}>
          <div className="field">
            <label className="label" htmlFor="company">
              Company / Organization <span className="auth-req">*</span>
            </label>
            <input
              className="input"
              id="company"
              name="company"
              type="text"
              required
              placeholder="Acme Inc."
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="name">
              Your Name <span className="auth-req">*</span>
            </label>
            <input
              className="input"
              id="name"
              name="name"
              type="text"
              required
              placeholder="Jane Smith"
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="email">
              Email <span className="auth-req">*</span>
            </label>
            <input
              className="input"
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="jane@acme.com"
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="password">
              Password <span className="auth-req">*</span>
            </label>
            <input
              className="input"
              id="password"
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              placeholder="At least 8 characters"
            />
          </div>

          <button className="btn btn-primary auth-submit" type="submit" disabled={sending}>
            {sending ? "Creating..." : "Create Account"}
          </button>
        </form>

        <div className="auth-center muted">
          Already have an account? <a href="/login">Sign in</a>
        </div>
      </div>
    </div>
  );
}
