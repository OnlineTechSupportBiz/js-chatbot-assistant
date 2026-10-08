"use client";

import { useState } from "react";

export interface WidgetPreviewProps {
  primaryColor: string;
  headerTextColor: string;
  headerGradientTo: string;
  accentColor: string;
  botName: string;
  headerIcon: string;
  headerSubtitle: string;
  placeholderIcon: string;
  placeholderTitle: string;
  placeholderText: string;
  position: "bottom-right" | "bottom-left";
  panelTheme: "light" | "dark";
}

function ChatIcon({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" fill={color} aria-hidden="true">
      <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z" />
    </svg>
  );
}

function SendIcon({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill={color} aria-hidden="true">
      <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
    </svg>
  );
}

/** Floating widget preview (matches the PHP form's live preview bubble + panel). */
export function WidgetPreview(p: WidgetPreviewProps) {
  const [open, setOpen] = useState(false);

  const headerBg =
    p.headerGradientTo && p.headerGradientTo !== p.primaryColor
      ? `linear-gradient(135deg, ${p.primaryColor}, ${p.headerGradientTo})`
      : p.primaryColor;

  const accent = p.accentColor || p.primaryColor;
  const isDark = p.panelTheme === "dark";
  const surface = isDark ? "#111d35" : "#ffffff";
  const bodyBg = isDark ? "#0a1628" : "#f5f7fa";
  const textSecondary = isDark ? "#bfc9d8" : "#4a5568";
  const borderColor = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";
  const placeholderTitleColor = isDark ? "#d0d8e0" : "#2c3e50";

  const fixedStyle: React.CSSProperties = {
    position: "fixed",
    zIndex: 9999,
    bottom: 20,
    ...(p.position === "bottom-left" ? { left: 20 } : { right: 20 }),
  };

  return (
    <div style={fixedStyle}>
      {open && (
        <div
          style={{
            position: "absolute",
            bottom: 72,
            right: p.position === "bottom-left" ? "auto" : 0,
            left: p.position === "bottom-left" ? 0 : "auto",
            width: 340,
            maxWidth: "calc(100vw - 40px)",
            borderRadius: 16,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            boxShadow: "0 8px 32px rgba(0,0,0,0.35)",
            background: surface,
            border: `1px solid ${borderColor}`,
          }}
        >
          <div
            style={{
              background: headerBg,
              color: p.headerTextColor,
              borderBottom: `3px solid ${accent}`,
              padding: "12px 16px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1 }}>
              {p.headerIcon && (
                <span style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(0,0,0,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>
                  {p.headerIcon}
                </span>
              )}
              <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <span style={{ fontWeight: 600, fontSize: 15, lineHeight: 1.3 }}>{p.botName}</span>
                {p.headerSubtitle && <span style={{ fontSize: 11, opacity: 0.8, lineHeight: 1.3 }}>{p.headerSubtitle}</span>}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close preview"
              style={{ background: "none", border: "none", color: p.headerTextColor, cursor: "pointer", fontSize: 20, opacity: 0.85 }}
            >
              &times;
            </button>
          </div>

          <div style={{ background: bodyBg, padding: 18, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 4, minHeight: 120 }}>
            {p.placeholderIcon && <div style={{ fontSize: 30, lineHeight: 1 }}>{p.placeholderIcon}</div>}
            {p.placeholderTitle && <div style={{ fontWeight: 600, fontSize: 15, color: placeholderTitleColor }}>{p.placeholderTitle}</div>}
            <div style={{ fontSize: 13, color: textSecondary }}>{p.placeholderText || "Ask me anything!"}</div>
          </div>

          <div style={{ display: "flex", padding: 10, gap: 8, borderTop: `1px solid ${borderColor}`, background: surface }}>
            <input
              type="text"
              placeholder="Type a message..."
              disabled
              style={{
                flex: 1,
                border: `1px solid ${borderColor}`,
                borderRadius: 20,
                padding: "8px 14px",
                fontSize: 14,
                background: isDark ? "rgba(255,255,255,0.04)" : "#f0f2f5",
                color: textSecondary,
              }}
            />
            <button
              type="button"
              tabIndex={-1}
              style={{ background: accent, width: 36, height: 36, borderRadius: "50%", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "default" }}
            >
              <SendIcon color="#ffffff" />
            </button>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={open ? "Hide preview" : "Show preview"}
        style={{
          width: 60,
          height: 60,
          borderRadius: "50%",
          background: p.primaryColor,
          border: "none",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
          transition: "transform 0.15s",
        }}
      >
        {open ? <span style={{ color: "#fff", fontSize: 22 }}>&times;</span> : <ChatIcon color="#ffffff" />}
      </button>
    </div>
  );
}