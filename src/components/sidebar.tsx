"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCsrf } from "@/components/hooks";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/chatbots", label: "Chatbots" },
  { href: "/leads", label: "Leads" },
  { href: "/conversations", label: "Conversations" },
  { href: "/settings", label: "Settings" },
  { href: "/audit", label: "Audit log" },
];

/**
 * Admin navigation.
 *
 * The drawer is CSS-driven: `globals.css` keeps it translated off-screen and
 * hidden below the `lg` breakpoint, and turns it into a static column from
 * `lg` up. The topbar (hamburger) only exists below `lg`, so on desktop the
 * open state is simply unreachable.
 */
export function Sidebar({ brandName = "Chatbot Assistant" }: { brandName?: string }) {
  const pathname = usePathname();
  const csrf = useCsrf();
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);

  // Following a link navigates away, so the drawer must not stay open over the
  // new page (on desktop the state is irrelevant, but it is shared).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Escape closes the drawer and returns focus to the control that opened it, so
  // keyboard users are not stranded with focus on an element that scrolled away.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        toggleRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // The open drawer covers the page, so stop the page behind it scrolling.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  function isActive(href: string): boolean {
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  async function logout() {
    await fetch("/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ _csrf: csrf }),
    });
    window.location.href = "/login";
  }

  return (
    <>
      <header className="admin-topbar">
        <button
          ref={toggleRef}
          type="button"
          className="nav-toggle"
          aria-label={open ? "Close navigation" : "Open navigation"}
          aria-expanded={open}
          aria-controls="admin-sidebar"
          onClick={() => setOpen((v) => !v)}
        >
          <span className="nav-toggle-bars" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        </button>
        <span className="admin-topbar-title">{brandName}</span>
      </header>

      {open && (
        <button
          type="button"
          className="sidebar-overlay"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
        />
      )}

      <aside id="admin-sidebar" className={`sidebar${open ? " is-open" : ""}`} aria-label="Main">
        <div className="sidebar-inner">
          <div className="sidebar-brand">
            {brandName}
            <button
              type="button"
              className="sidebar-close"
              aria-label="Close navigation"
              onClick={() => setOpen(false)}
            >
              &times;
            </button>
          </div>
          <nav className="sidebar-nav">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={isActive(n.href) ? "active" : ""}
                aria-current={isActive(n.href) ? "page" : undefined}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="sidebar-foot">
            <button type="button" className="sidebar-signout" onClick={logout}>
              Sign out
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}