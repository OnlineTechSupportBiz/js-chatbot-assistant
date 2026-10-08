"use client";

import { useEffect, useState } from "react";

const BRAND = "Chatbot Assistant";

/**
 * Sign-in form (password or magic link).
 *
 * `registrationEnabled` comes from the server page, which reads
 * `ALLOW_REGISTRATION` from the environment: the "Create one" link is hidden
 * when the gate is closed, so it never leads to a redirect loop back here.
 */
export function LoginForm({ registrationEnabled }: { registrationEnabled: boolean }) {
  const [tab, setTab] = useState<"password" | "magic">("password");
  const [csrf, setCsrf] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    // Preselect the magic tab the way the PHP view does (?tab=magic).
    const q = new URLSearchParams(window.location.search).get("tab");
    if (q === "magic") setTab("magic");

    fetch("/csrf")
      .then((r) => r.json())
      .then((d) => setCsrf(d.csrf))
      .catch(() => {});
  }, []);

  function switchTab(next: "password" | "magic") {
    setTab(next);
    setError("");
    setNotice("");
  }

  async function submitPassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: fd.get("email"),
        password: fd.get("password"),
        remember: fd.get("remember") ? "1" : "",
        _csrf: csrf,
      }),
    });
    const data = await res.json();
    if (data.redirect) window.location.href = data.redirect;
    else setError(data.error ?? "Login failed.");
  }

  async function submitMagic(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSending(true);
    const fd = new FormData(e.currentTarget);
    try {
      const res = await fetch("/magic-login/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: fd.get("email"), _csrf: csrf }),
      });
      if (res.ok) {
        setError("");
        setNotice("If an account exists, we have emailed you a sign-in link.");
      } else {
        setError("Could not send the sign-in link. Please try again.");
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
        <h1>Welcome Back</h1>
        <p className="auth-subtitle">Sign in to your account.</p>

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

        <div className="auth-tabs" role="tablist">
          <button
            className={"auth-tab" + (tab === "password" ? " active" : "")}
            type="button"
            onClick={() => switchTab("password")}
          >
            Sign in with Password
          </button>
          <button
            className={"auth-tab" + (tab === "magic" ? " active" : "")}
            type="button"
            onClick={() => switchTab("magic")}
          >
            Sign in with Magic Link
          </button>
        </div>

        {tab === "password" ? (
          <>
            <form onSubmit={submitPassword}>
              <div className="field">
                <label className="label" htmlFor="email">
                  Email
                </label>
                <input
                  className="input"
                  id="email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  autoFocus
                />
              </div>
              <div className="field">
                <label className="label" htmlFor="password">
                  Password
                </label>
                <input
                  className="input"
                  id="password"
                  name="password"
                  type="password"
                  required
                  autoComplete="current-password"
                />
              </div>
              <label className="auth-remember">
                <input name="remember" type="checkbox" value="1" /> Remember me
              </label>
              <button className="btn btn-primary auth-submit" type="submit">
                Sign In
              </button>
            </form>
            <div className="auth-center">
              <a href="/forgot-password">Forgot your password?</a>
            </div>
          </>
        ) : (
          <>
            <p className="muted auth-note">
              We will send a one-time sign-in link to your email. No password needed.
            </p>
            <form onSubmit={submitMagic}>
              <div className="field">
                <label className="label" htmlFor="magic-email">
                  Email
                </label>
                <input
                  className="input"
                  id="magic-email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                />
              </div>
              <button className="btn btn-primary auth-submit" type="submit" disabled={sending}>
                {sending ? "Sending..." : "Send Magic Link"}
              </button>
            </form>
          </>
        )}

        {registrationEnabled && (
          <div className="auth-center muted">
            Don&apos;t have an account? <a href="/register">Create one</a>
          </div>
        )}
      </div>
    </div>
  );
}
