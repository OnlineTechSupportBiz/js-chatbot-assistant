"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useCsrf, useFetch } from "@/components/hooks";
import { groupedPresets } from "@/presets/industry-presets";
import { WidgetPreview } from "@/components/admin/widget-preview";

interface ModelConfig {
  model?: string;
  temperature?: number;
  max_tokens?: number;
}

interface Styling {
  primary_color?: string;
  header_text_color?: string;
  header_gradient_to?: string;
  accent_color?: string;
  header_icon?: string;
  header_subtitle?: string;
  placeholder_icon?: string;
  placeholder_title?: string;
  placeholder_text?: string;
  position?: string;
  bot_name?: string;
  widget_theme?: string;
  panel_theme?: string;
}

export interface ChatbotDetail {
  id: number;
  name: string;
  industry: string | null;
  system_prompt: string | null;
  model_config: ModelConfig | null;
  styling: Styling | null;
  status: string;
  retrieval_strategy: string;
  allowed_domains: string | null;
  lead_capture_enabled: number;
  daily_token_budget: number | null;
  rate_limit_per_session: number | null;
  rate_limit_per_ip: number | null;
  rate_limit_per_token: number | null;
  max_message_length: number | null;
  max_messages_per_conversation: number | null;
  widget_token: string;
  /** Server-wide abuse ceilings from the deployment environment (read-only). */
  rateCeilings?: { maxPerIp: number; maxPerToken: number; windowSeconds: number };
}

const n = (v: number | null | undefined) => (v == null ? "" : String(v));

interface Style {
  primaryColor: string;
  headerTextColor: string;
  headerGradientTo: string;
  accentColor: string;
  headerIcon: string;
  headerSubtitle: string;
  placeholderIcon: string;
  placeholderTitle: string;
  placeholderText: string;
  position: "bottom-right" | "bottom-left";
  botName: string;
  panelTheme: "light" | "dark";
}

interface FlatPreset {
  category: string;
  label: string;
  prompt: string;
}

// Flatten the industry presets (skip the "Custom" placeholder category).
const allPresets: FlatPreset[] = [];
for (const g of groupedPresets().filter((g) => g.category !== "Custom")) {
  for (const p of g.presets) {
    allPresets.push({ category: g.category, label: p.label, prompt: p.prompt });
  }
}

const grouped = groupedPresets().filter((g) => g.category !== "Custom");

function presetIndex(industry: string | null, prompt: string | null): string {
  if (industry) {
    const idx = allPresets.findIndex((p) => p.category === industry && p.prompt === (prompt ?? ""));
    if (idx >= 0) return String(idx);
  }
  return prompt ? "__custom__" : "";
}

// Widget icon choices (ported from the PHP form's icon dropdowns).
const ICON_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "None" },
  { value: "💬", label: "💬 Chat" },
  { value: "🤖", label: "🤖 Robot / AI" },
  { value: "🚀", label: "🚀 Rocket" },
  { value: "⭐", label: "⭐ Star" },
  { value: "🎯", label: "🎯 Target" },
  { value: "🔥", label: "🔥 Fire" },
  { value: "💡", label: "💡 Lightbulb" },
  { value: "👋", label: "👋 Wave" },
  { value: "❓", label: "❓ Question" },
  { value: "✅", label: "✅ Checkmark" },
  { value: "🔔", label: "🔔 Bell" },
  { value: "📧", label: "📧 Email" },
  { value: "📱", label: "📱 Phone" },
  { value: "📝", label: "📝 Document" },
  { value: "🗨️", label: "🗨️ Speech" },
  { value: "👤", label: "👤 Person" },
  { value: "👑", label: "👑 Crown" },
  { value: "💎", label: "💎 Diamond" },
  { value: "🏆", label: "🏆 Trophy" },
  { value: "🎁", label: "🎁 Gift" },
  { value: "🔒", label: "🔒 Lock" },
  { value: "🌍", label: "🌍 Globe" },
  { value: "☕", label: "☕ Coffee" },
  { value: "🎵", label: "🎵 Music" },
  { value: "🖥️", label: "🖥️ Monitor" },
  { value: "🎮", label: "🎮 Gaming" },
  { value: "🌿", label: "🌿 Agriculture" },
  { value: "🔧", label: "🔧 Auto Repair" },
  { value: "🏗️", label: "🏗️ Construction" },
  { value: "🛒", label: "🛒 E-Commerce" },
  { value: "📚", label: "📚 Education" },
  { value: "⚡", label: "⚡ Energy" },
  { value: "💰", label: "💰 Finance" },
  { value: "💪", label: "💪 Fitness" },
  { value: "🍕", label: "🍕 Food & Beverage" },
  { value: "🏛️", label: "🏛️ Government" },
  { value: "❤️", label: "❤️ Healthcare" },
  { value: "🏠", label: "🏠 Home Services" },
  { value: "✈️", label: "✈️ Hospitality" },
  { value: "👥", label: "👥 HR" },
  { value: "🛡️", label: "🛡️ Insurance" },
  { value: "⚖️", label: "⚖️ Legal" },
  { value: "🚚", label: "🚚 Logistics" },
  { value: "🏭", label: "🏭 Manufacturing" },
  { value: "📊", label: "📊 Marketing" },
  { value: "🎬", label: "🎬 Media" },
  { value: "🤝", label: "🤝 Nonprofit" },
  { value: "🐾", label: "🐾 Pet Services" },
  { value: "💊", label: "💊 Pharma" },
  { value: "🏡", label: "🏡 Real Estate" },
  { value: "💻", label: "💻 Technology" },
  { value: "📡", label: "📡 Telecommunications" },
];

// Widget theme presets (ported verbatim from the PHP form).
const WIDGET_THEMES: { key: string; label: string; primary: string; gradientTo: string; accent: string; headerText: string; desc: string }[] = [
  { key: "", label: "✏️ Custom", primary: "#0d6efd", gradientTo: "", accent: "", headerText: "#ffffff", desc: "Choose your own colors below" },
  { key: "default-blue", label: "🔵 Default Blue", primary: "#0d6efd", gradientTo: "", accent: "", headerText: "#ffffff", desc: "Clean, classic blue — professional and familiar" },
  { key: "emerald-green", label: "🟢 Emerald Green", primary: "#10b981", gradientTo: "", accent: "", headerText: "#ffffff", desc: "Fresh, growth-oriented green" },
  { key: "royal-purple", label: "🟣 Royal Purple", primary: "#7c3aed", gradientTo: "", accent: "", headerText: "#ffffff", desc: "Bold and creative purple" },
  { key: "crimson-red", label: "🔴 Crimson Red", primary: "#dc2626", gradientTo: "", accent: "", headerText: "#ffffff", desc: "Strong, urgent red for support teams" },
  { key: "amber-orange", label: "🟠 Amber Orange", primary: "#f59e0b", gradientTo: "", accent: "", headerText: "#1e293b", desc: "Warm, friendly amber — dark header text for contrast" },
  { key: "ocean-teal", label: "🩵 Ocean Teal", primary: "#0d9488", gradientTo: "", accent: "", headerText: "#ffffff", desc: "Calming teal for professional service bots" },
  { key: "rose-pink", label: "🩷 Rose Pink", primary: "#e11d48", gradientTo: "", accent: "", headerText: "#ffffff", desc: "Vibrant rose for brand-forward businesses" },
  { key: "slate-dark", label: "⚫ Slate Dark", primary: "#1e293b", gradientTo: "", accent: "", headerText: "#f8fafc", desc: "Sleek dark slate for modern premium brands" },
  { key: "sky-blue", label: "💙 Sky Blue", primary: "#0284c7", gradientTo: "", accent: "", headerText: "#ffffff", desc: "Bright, trustworthy sky blue" },
  { key: "lime-green", label: "💚 Lime Green", primary: "#65a30d", gradientTo: "", accent: "", headerText: "#ffffff", desc: "Energetic lime for eco-friendly brands" },
  { key: "deep-forest", label: "🌲 Deep Forest", primary: "#14532d", gradientTo: "#0a3018", accent: "#eab308", headerText: "#ffffff", desc: "Rich green with golden accent — grounded and natural" },
  { key: "steel-navy", label: "⚓ Steel Navy", primary: "#1a365d", gradientTo: "#162240", accent: "#d35400", headerText: "#ffffff", desc: "Dark navy with burnt orange accent — rugged and reliable" },
  { key: "construction", label: "🏗️ Construction", primary: "#1a365d", gradientTo: "#162240", accent: "#ff7800", headerText: "#ffffff", desc: "Navy with bright orange accent — bold and industrial" },
  { key: "stone", label: "🪨 Stone", primary: "#292524", gradientTo: "#1a1716", accent: "#f59e0b", headerText: "#ffffff", desc: "Earthy brown with warm gold accent — sturdy and honest" },
  { key: "twilight", label: "🌆 Twilight", primary: "#6b21a8", gradientTo: "#581c87", accent: "#e11d48", headerText: "#ffffff", desc: "Deep purple with rose accent — bold and creative" },
  { key: "indigo-night", label: "🌙 Indigo Night", primary: "#3730a3", gradientTo: "#2c2585", accent: "#d97706", headerText: "#ffffff", desc: "Indigo with amber accent — thoughtful and premium" },
  { key: "midnight", label: "🌃 Midnight", primary: "#0f172a", gradientTo: "#070b15", accent: "#22c55e", headerText: "#ffffff", desc: "Deep night blue with green accent — sleek and modern" },
  { key: "deep-teal", label: "🌊 Deep Teal", primary: "#075985", gradientTo: "#06486b", accent: "#059669", headerText: "#ffffff", desc: "Rich teal with emerald accent — calm and trustworthy" },
  { key: "burgundy", label: "🍷 Burgundy", primary: "#7f1d1d", gradientTo: "#5c1515", accent: "#dc2626", headerText: "#ffffff", desc: "Deep wine with red accent — sophisticated and warm" },
  { key: "slate", label: "🏔️ Slate", primary: "#1e293b", gradientTo: "#141d28", accent: "#64748b", headerText: "#ffffff", desc: "Cool gray-blue — neutral and professional" },
  { key: "sea-glass", label: "🫧 Sea Glass", primary: "#0d6e6e", gradientTo: "#0a5c5c", accent: "#0b7a5a", headerText: "#ffffff", desc: "Teal dual-tone with forest accent — fresh and healing" },
  { key: "royal-blue", label: "👑 Royal Blue", primary: "#1e3a8a", gradientTo: "#152b6e", accent: "#db2777", headerText: "#ffffff", desc: "Classic blue with pink accent — confident and dynamic" },
  { key: "slate-blue", label: "🔷 Slate Blue", primary: "#1e3a5f", gradientTo: "#15294a", accent: "#dc2626", headerText: "#ffffff", desc: "Muted navy with red accent — stable and assertive" },
  { key: "dark-umber", label: "🟤 Dark Umber", primary: "#1e293b", gradientTo: "#0f172a", accent: "#92400e", headerText: "#ffffff", desc: "Deep slate with brown accent — grounded and authoritative" },
  { key: "deep-navy", label: "⚫ Deep Navy", primary: "#0f172a", gradientTo: "#090e1c", accent: "#ea580c", headerText: "#ffffff", desc: "Near-black navy with orange accent — bold and energetic" },
  { key: "charcoal", label: "🖤 Charcoal", primary: "#27272a", gradientTo: "#1a1a1d", accent: "#ca8a04", headerText: "#ffffff", desc: "Dark charcoal with gold accent — industrial and premium" },
  { key: "plum", label: "🍇 Plum", primary: "#7b1fa2", gradientTo: "#59167a", accent: "#ff6d00", headerText: "#ffffff", desc: "Vibrant plum with orange accent — creative and energetic" },
  { key: "wine", label: "🍒 Wine", primary: "#4c0519", gradientTo: "#2d030f", accent: "#d946ef", headerText: "#ffffff", desc: "Deep merlot with magenta accent — bold and luxurious" },
  { key: "jade", label: "💎 Jade", primary: "#065f46", gradientTo: "#033d2f", accent: "#f59e0b", headerText: "#ffffff", desc: "Rich jade with gold accent — prosperous and natural" },
  { key: "amethyst", label: "💜 Amethyst", primary: "#5b21b6", gradientTo: "#3b1078", accent: "#f472b6", headerText: "#ffffff", desc: "Deep purple with pink accent — whimsical and creative" },
  { key: "classic-blue", label: "💠 Classic Blue", primary: "#2563eb", gradientTo: "#1d4ed8", accent: "#7c3aed", headerText: "#ffffff", desc: "Clean blue with purple accent — modern SaaS standard" },
  { key: "slate-steel", label: "🔩 Slate Steel", primary: "#1b2838", gradientTo: "#121d2c", accent: "#0284c7", headerText: "#ffffff", desc: "Industrial slate with cyan accent — technical and precise" },
];

function escapeAttr(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

const EMPTY_CHATBOT: ChatbotDetail = {
  id: 0,
  name: "",
  industry: null,
  system_prompt: null,
  status: "active",
  retrieval_strategy: "traditional_rag",
  widget_token: "",
  lead_capture_enabled: 0,
  daily_token_budget: 100000,
  rate_limit_per_session: null,
  rate_limit_per_ip: null,
  rate_limit_per_token: null,
  max_message_length: null,
  max_messages_per_conversation: null,
  allowed_domains: null,
  model_config: null,
  styling: null,
};

export function SettingsForm({
  chatbot: chatbotProp,
  onSaved,
  mode = "edit",
  onCreated,
}: {
  chatbot: ChatbotDetail;
  onSaved: () => void;
  mode?: "edit" | "create";
  onCreated?: (id: number) => void;
}) {
  const isCreate = mode === "create";
  const chatbot = isCreate ? EMPTY_CHATBOT : chatbotProp;
  const csrf = useCsrf();
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  // Confirmation has to appear where the click happened: on a form this long the
  // Save button is below the fold, so the message lives beside the button and the
  // button itself flips to "Saved ✓" for a few seconds.
  const [justSaved, setJustSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (savedTimer.current) clearTimeout(savedTimer.current);
  }, []);
  const [busy, setBusy] = useState(false);
  const mc = chatbot.model_config ?? {};
  const st = chatbot.styling ?? {};
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  const [model, setModel] = useState(mc.model ?? "");
  const { data: settingsData } = useFetch<{ llm_models: { name: string; model: string }[] }>("/api/admin/settings");
  const modelOptions = settingsData?.llm_models ?? [];
  const [dailyBudget, setDailyBudget] = useState(n(chatbot.daily_token_budget));
  const [industry, setIndustry] = useState(chatbot.industry ?? "");
  const [systemPrompt, setSystemPrompt] = useState(chatbot.system_prompt ?? "");
  const [industryKey, setIndustryKey] = useState(presetIndex(chatbot.industry, chatbot.system_prompt));
  const [promptSource, setPromptSource] = useState("");
  const [copied, setCopied] = useState(false);
  const [style, setStyle] = useState<Style>({
    primaryColor: st.primary_color ?? "#0d6efd",
    headerTextColor: st.header_text_color ?? "#ffffff",
    headerGradientTo: st.header_gradient_to ?? "",
    accentColor: st.accent_color ?? "",
    headerIcon: st.header_icon ?? "",
    headerSubtitle: st.header_subtitle ?? "",
    placeholderIcon: st.placeholder_icon ?? "",
    placeholderTitle: st.placeholder_title ?? "",
    placeholderText: st.placeholder_text ?? "",
    position: st.position === "bottom-left" ? "bottom-left" : "bottom-right",
    botName: st.bot_name ?? "Assistant",
    panelTheme: st.panel_theme === "dark" ? "dark" : "light",
  });

  const [widgetTheme, setWidgetTheme] = useState(
    WIDGET_THEMES.find((t) => t.primary === (st.primary_color ?? "#0d6efd") && t.headerText === (st.header_text_color ?? "#ffffff") && t.key !== "")?.key ?? ""
  );
  const themeDesc = WIDGET_THEMES.find((t) => t.key === widgetTheme)?.desc ?? "Choose a theme or set custom colors below";

  function upd<K extends keyof Style>(key: K, value: Style[K]) {
    setStyle((s) => ({ ...s, [key]: value }));
  }

  function onThemeChange(key: string) {
    setWidgetTheme(key);
    const t = WIDGET_THEMES.find((x) => x.key === key);
    if (!t) return;
    setStyle((s) => ({
      ...s,
      primaryColor: t.primary,
      headerTextColor: t.headerText,
      headerGradientTo: t.gradientTo || t.primary,
      accentColor: t.accent || t.primary,
    }));
  }

  function onIndustryChange(key: string) {
    setIndustryKey(key);
    if (key === "" || key === "__custom__") {
      setPromptSource(key === "__custom__" ? "Custom prompt — write whatever you like." : "");
      if (key === "") setIndustry("");
      return;
    }
    const preset = allPresets[parseInt(key, 10)];
    if (preset) {
      setIndustry(preset.category);
      setSystemPrompt(preset.prompt);
      setPromptSource(`Template: ${preset.label} · ${preset.category}`);
    }
  }

  function buildEmbedCode(): string {
    const s = style;
    const primary = s.primaryColor || "#0d6efd";
    const headerText = s.headerTextColor || "#ffffff";
    const lines: string[] = [`<script src="${origin}/widget.js"`];
    lines.push(`        data-widget-token="${escapeAttr(chatbot.widget_token)}"`);
    lines.push(`        data-api-base="${escapeAttr(origin)}"`);
    lines.push(`        data-bot-name="${escapeAttr(s.botName || "Assistant")}"`);
    lines.push(`        data-primary-color="${primary}"`);
    lines.push(`        data-header-text-color="${headerText}"`);
    if (s.headerGradientTo && s.headerGradientTo !== primary) lines.push(`        data-header-gradient-to="${s.headerGradientTo}"`);
    if (s.accentColor && s.accentColor !== primary) lines.push(`        data-accent-color="${s.accentColor}"`);
    if (s.headerIcon) lines.push(`        data-header-icon="${escapeAttr(s.headerIcon)}"`);
    if (s.headerSubtitle) lines.push(`        data-header-subtitle="${escapeAttr(s.headerSubtitle)}"`);
    if (s.placeholderIcon) lines.push(`        data-placeholder-icon="${escapeAttr(s.placeholderIcon)}"`);
    if (s.placeholderTitle) lines.push(`        data-placeholder-title="${escapeAttr(s.placeholderTitle)}"`);
    if (s.placeholderText && s.placeholderText !== "Ask me anything!") lines.push(`        data-placeholder-text="${escapeAttr(s.placeholderText)}"`);
    lines.push(`        data-widget-theme="${s.panelTheme}"`);
    lines.push(`        data-position="${s.position}">`);
    lines.push(`</script>`);
    return lines.join("\n");
  }

  const embedCode = buildEmbedCode();

  async function copyEmbed() {
    try {
      await navigator.clipboard.writeText(embedCode);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = embedCode;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch {}
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    const fd = new FormData(e.currentTarget);
    const payload = {
      name: fd.get("name"),
      industry,
      systemPrompt,
      status: fd.get("status"),
      retrievalStrategy: fd.get("retrievalStrategy"),
      allowedDomains: fd.get("allowedDomains"),
      leadCaptureEnabled: fd.get("leadCaptureEnabled") ? "1" : "",
      dailyTokenBudget: fd.get("dailyTokenBudget"),
      rateLimitPerSession: fd.get("rateLimitPerSession"),
      rateLimitPerIp: fd.get("rateLimitPerIp"),
      rateLimitPerToken: fd.get("rateLimitPerToken"),
      maxMessageLength: fd.get("maxMessageLength"),
      maxMessagesPerConversation: fd.get("maxMessagesPerConversation"),
      model,
      temperature: fd.get("temperature"),
      maxTokens: fd.get("maxTokens"),
      primaryColor: style.primaryColor,
      headerTextColor: style.headerTextColor,
      headerGradientTo: style.headerGradientTo,
      accentColor: style.accentColor,
      headerIcon: style.headerIcon,
      headerSubtitle: style.headerSubtitle,
      placeholderIcon: style.placeholderIcon,
      placeholderTitle: style.placeholderTitle,
      placeholderText: style.placeholderText,
      position: style.position,
      botName: style.botName,
      panelTheme: style.panelTheme,
      _csrf: csrf,
    };
    const res = isCreate
      ? await fetch("/api/admin/chatbots", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      : await fetch(`/api/admin/chatbots/${chatbot.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) {
      setMsg({ kind: "err", text: (body as { error?: string }).error ?? "Could not save." });
      return;
    }
    if (isCreate) {
      const newId = (body as { id?: number }).id;
      setMsg({ kind: "ok", text: "Chatbot created." });
      if (onCreated && newId) onCreated(newId);
      return;
    }
    setMsg({ kind: "ok", text: "Chatbot saved." });
    setJustSaved(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setJustSaved(false), 3000);
    onSaved();
  }

  const colorInput = (value: string, onChange: (v: string) => void) => (
    // Like the PHP form, an empty color falls back to the current primary so the
    // picker always shows a usable value.
    <input
      className="input"
      type="color"
      value={value || style.primaryColor || "#0d6efd"}
      onChange={(e) => onChange(e.target.value)}
    />
  );

  const iconSelect = (value: string, onChange: (v: string) => void) => (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
      {ICON_OPTIONS.map((o) => (
        <option key={o.value || "none"} value={o.value}>{o.label}</option>
      ))}
    </select>
  );

  return (
    <form onSubmit={submit}>
      <div className="card">
        <h2>Basics</h2>
        <div className="form-row">
          <div className="field">
            <label className="label" htmlFor="name">Chatbot name <span style={{ color: "var(--danger)" }}>*</span></label>
            <input className="input" id="name" name="name" defaultValue={chatbot.name} required maxLength={255} />
          </div>
          {!isCreate && (
          <div className="field">
            <label className="label" htmlFor="status">Status</label>
            <select className="select" id="status" name="status" defaultValue={chatbot.status}>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
            </select>
          </div>
          )}
          <div className="field">
            <label className="label" htmlFor="industry">Industry / prompt template</label>
            <select className="select" id="industry" name="industry" value={industryKey} onChange={(e) => onIndustryChange(e.target.value)}>
              <option value="">— Select a template —</option>
              <option value="__custom__">✏️ Custom (write your own prompt)</option>
              {grouped.map((g) => (
                <optgroup key={g.category} label={g.category}>
                  {g.presets.map((p) => {
                    const idx = allPresets.findIndex((x) => x.category === g.category && x.label === p.label && x.prompt === p.prompt);
                    return <option key={idx} value={String(idx)}>{p.label}</option>;
                  })}
                </optgroup>
              ))}
            </select>
            <div className="muted" style={{ fontSize: "0.8rem" }}>Select an industry to auto-fill the system prompt. Choose &quot;Custom&quot; to write your own.</div>
          </div>
        </div>
        <div className="field">
          <label className="label" htmlFor="systemPrompt">System prompt</label>
          <textarea className="textarea" id="systemPrompt" name="systemPrompt" rows={5}
            placeholder="You are a helpful assistant for [company]. Answer questions based on the provided documents."
            value={systemPrompt}
            onChange={(e) => { setSystemPrompt(e.target.value); setIndustryKey("__custom__"); setPromptSource(""); }}
          />
          <div className="muted" style={{ fontSize: "0.8rem" }}>
            Instructions that define your chatbot&apos;s personality and behavior.
            {promptSource && <> <span id="prompt-source">{promptSource}</span></>}
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Model</h2>
        <div className="form-row">
          <div className="field">
            <label className="label" htmlFor="model">Model</label>
            <select className="select" id="model" name="model" value={model} onChange={(e) => setModel(e.target.value)}>
              <option value="">Select a model…</option>
              {modelOptions.map((o) => (
                <option key={o.name} value={o.name}>{o.name}{o.model ? ` (${o.model})` : ""}</option>
              ))}
            </select>
            <div className="muted" style={{ fontSize: "0.8rem" }}>
              {modelOptions.length === 0
                ? <>No models configured yet. Add models with their providers in <a href="/settings">Settings → Model management</a> first.</>
                : "Choose from the models in Settings; the others act as failover."}
            </div>
          </div>
          <div className="field">
            <label className="label" htmlFor="temperature">Temperature</label>
            <input className="input" id="temperature" name="temperature" type="number" min="0" max="2" step="0.1" defaultValue={mc.temperature ?? 0} />
            <div className="muted" style={{ fontSize: "0.8rem" }}>0 = deterministic, 2 = very creative.</div>
          </div>
          <div className="field">
            <label className="label" htmlFor="maxTokens">Max tokens</label>
            <input className="input" id="maxTokens" name="maxTokens" type="number" min="64" max="16384" step="1" defaultValue={mc.max_tokens ?? 1024} />
            <div className="muted" style={{ fontSize: "0.8rem" }}>
              Max response length. <strong>Short Q&amp;A:</strong> 256–512 ·
              <strong> Default:</strong> 1024 ·
              <strong> Long answers/code:</strong> 2048–4096 ·
              <strong> Max output:</strong> 16384. Higher = more tokens billed.
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Lead capture</h2>
        <label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
          <input type="checkbox" id="leadCaptureEnabled" name="leadCaptureEnabled" value="1" defaultChecked={chatbot.lead_capture_enabled === 1} />
          <strong>Enable lead capture</strong>
        </label>
        <div className="muted" style={{ fontSize: "0.8rem", marginTop: "0.35rem" }}>
          When enabled, the chatbot will naturally ask visitors for their name, email address,
          and phone number during the conversation. Once all three are collected, they are
          stored as leads and viewable from the chatbot&apos;s management page.
        </div>
        <div className="muted" style={{ fontSize: "0.8rem", marginTop: "0.35rem" }}>
          <strong>How it works:</strong> The AI asks for each piece of information one at a time.
          When it detects all three fields have been provided, the lead is automatically saved
          to this chatbot&apos;s lead list.
        </div>
      </div>

      <div className="card">
        <h2>Retrieval strategy</h2>
        <div className="field">
          <label className="label">Document retrieval method</label>
          <div className="row">
            <label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
              <input type="radio" name="retrievalStrategy" value="traditional_rag" defaultChecked={(chatbot.retrieval_strategy ?? "traditional_rag") === "traditional_rag"} />
              <strong>Traditional RAG</strong>
            </label>
            <label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
              <input type="radio" name="retrievalStrategy" value="page_index" defaultChecked={chatbot.retrieval_strategy === "page_index"} />
              <strong>PageIndex</strong>
            </label>
          </div>
          <div className="muted" style={{ fontSize: "0.8rem", marginTop: "0.5rem" }}>
            <strong>Traditional RAG:</strong> Documents are chunked and embedded into a vector
            database. At query time, the chatbot uses embedding similarity search to find relevant
            passages. Best for most use cases — fast, proven, and accurate.
          </div>
          <div className="muted" style={{ fontSize: "0.8rem", marginTop: "0.35rem" }}>
            <strong>PageIndex:</strong> Documents are parsed into a hierarchical table of contents
            structure. At query time, an LLM reasons over the outline to find the most relevant
            section — no embedding needed. Best for well-structured documents with clear
            headings and sections. Requires additional processing after document upload.
          </div>
          <div className="muted" style={{ fontSize: "0.8rem", marginTop: "0.5rem" }}>
            Note: Changing the strategy after documents have been indexed will not automatically
            reprocess existing documents. You must re-upload and re-index documents after switching.
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Widget appearance</h2>

        <div className="form-row">
          <div className="field">
            <label className="label" htmlFor="widgetTheme">🎨 Theme preset</label>
            <select className="select" id="widgetTheme" name="widgetTheme" value={widgetTheme} onChange={(e) => onThemeChange(e.target.value)}>
              {WIDGET_THEMES.map((t) => (
                <option key={t.key || "custom"} value={t.key}>{t.label}</option>
              ))}
            </select>
            <div className="muted" style={{ fontSize: "0.8rem" }} id="theme-desc">{themeDesc}</div>
          </div>
          <div className="field">
            <label className="label">Widget panel theme</label>
            <div className="row">
              <label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
                <input type="radio" name="panelTheme" value="light" checked={style.panelTheme === "light"} onChange={() => upd("panelTheme", "light")} />
                Light
              </label>
              <label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
                <input type="radio" name="panelTheme" value="dark" checked={style.panelTheme === "dark"} onChange={() => upd("panelTheme", "dark")} />
                Dark
              </label>
            </div>
            <div className="muted" style={{ fontSize: "0.8rem" }}>Light panel is white/silver; dark panel is navy/charcoal. Presets look best with dark mode unless you pick a light-friendly header text color.</div>
          </div>
        </div>

        <div className="form-row">
          <div className="field">
            <label className="label" htmlFor="botName">Bot display name</label>
            <input className="input" id="botName" name="botName" value={style.botName} onChange={(e) => upd("botName", e.target.value)} maxLength={100} />
          </div>
          <div className="field">
            <label className="label" htmlFor="primaryColor">Primary</label>
            {colorInput(style.primaryColor, (v) => upd("primaryColor", v))}
          </div>
          <div className="field">
            <label className="label" htmlFor="headerGradientTo">Gradient</label>
            {colorInput(style.headerGradientTo, (v) => upd("headerGradientTo", v))}
            <div className="muted" style={{ fontSize: "0.8rem" }}>Leave same as Primary for solid header.</div>
          </div>
          <div className="field">
            <label className="label" htmlFor="accentColor">Accent</label>
            {colorInput(style.accentColor, (v) => upd("accentColor", v))}
            <div className="muted" style={{ fontSize: "0.8rem" }}>Send button, links, hover effects. Leave blank to match Primary.</div>
          </div>
          <div className="field">
            <label className="label" htmlFor="headerTextColor">Header text</label>
            {colorInput(style.headerTextColor, (v) => upd("headerTextColor", v))}
          </div>
        </div>

        <div className="form-row">
          <div className="field">
            <label className="label" htmlFor="headerIcon">Header icon</label>
            {iconSelect(style.headerIcon, (v) => upd("headerIcon", v))}
          </div>
          <div className="field">
            <label className="label" htmlFor="headerSubtitle">Header subtitle</label>
            <input className="input" id="headerSubtitle" name="headerSubtitle" value={style.headerSubtitle} onChange={(e) => upd("headerSubtitle", e.target.value)} maxLength={100} placeholder="e.g. Online" />
          </div>
          <div className="field">
            <label className="label" htmlFor="position">Widget position</label>
            <select className="select" id="position" name="position" value={style.position} onChange={(e) => upd("position", e.target.value as Style["position"])}>
              <option value="bottom-right">Bottom right</option>
              <option value="bottom-left">Bottom left</option>
            </select>
          </div>
        </div>

        <div className="form-row">
          <div className="field">
            <label className="label" htmlFor="placeholderIcon">Placeholder icon</label>
            {iconSelect(style.placeholderIcon, (v) => upd("placeholderIcon", v))}
          </div>
          <div className="field">
            <label className="label" htmlFor="placeholderTitle">Placeholder title</label>
            <input className="input" id="placeholderTitle" name="placeholderTitle" value={style.placeholderTitle} onChange={(e) => upd("placeholderTitle", e.target.value)} maxLength={100} placeholder="e.g. How can I help?" />
          </div>
          <div className="field">
            <label className="label" htmlFor="placeholderText">Placeholder body</label>
            <input className="input" id="placeholderText" name="placeholderText" value={style.placeholderText} onChange={(e) => upd("placeholderText", e.target.value)} maxLength={200} placeholder="Ask me anything!" />
          </div>
        </div>
      </div>

      {!isCreate && (
      <div className="card">
        <h2>Embed code</h2>
        <div className="muted" style={{ fontSize: "0.8rem", marginBottom: "0.5rem" }}>
          Add this snippet to any website to show the chat widget. It updates live as you change the appearance above.
        </div>
        <pre className="code-block">{embedCode}</pre>
        <div className="form-actions" style={{ marginTop: "0.75rem" }}>
          <button type="button" className="btn" onClick={copyEmbed}>{copied ? "Copied!" : "Copy embed code"}</button>
        </div>
        <div className="muted" style={{ fontSize: "0.8rem" }}>Embed this snippet in any website to add this chatbot. Changes above update the code live.</div>
      </div>
      )}

      <div className="card">
        <h2>Domain security</h2>
        <div className="field">
          <label className="label" htmlFor="allowedDomains">Allowed domains — CORS restriction</label>
          <textarea className="textarea" id="allowedDomains" name="allowedDomains" rows={3} placeholder={"example.com\nwww.example.com"} defaultValue={chatbot.allowed_domains ?? ""} />
          <div className="muted" style={{ fontSize: "0.8rem", marginTop: "0.35rem" }}>
            <strong>Why is this needed?</strong> Without domain restrictions, anyone can copy your embed code
            onto their own website and use your chatbot — consuming your token budget and exposing your
            chatbot to unauthorized visitors. By listing only the domains you own, the server will reject requests
            that come from any other origin.
          </div>
          <div className="muted" style={{ fontSize: "0.8rem", marginTop: "0.35rem" }}>
            Enter one domain per line. You can paste full URLs — protocols, paths,
            and default ports (80/443) are automatically stripped.
            You may include port numbers for non-standard ports (e.g., <code>localhost:3000</code> for local development).
            A bare domain (no port) matches <strong>any port</strong> on that host —
            <code>localhost</code> allows <code>http://localhost:3000</code>, <code>http://localhost:8080</code>, etc.
            Use <code>example.com:*</code> to allow any port on that domain.
          </div>
          <div className="muted" style={{ fontSize: "0.8rem", marginTop: "0.35rem" }}>
            <strong>Content Security Policy (CSP) note:</strong> For your own website, you also need to set a
            Content-Security-Policy header that allows the chatbot scripts and connections. Add this to your
            site&apos;s <code>&lt;head&gt;</code> or server config:
          </div>
          <pre className="code-block" style={{ marginTop: "0.35rem" }}>{`<meta http-equiv="Content-Security-Policy" content="
    script-src 'self' ${origin};
    connect-src 'self' ${origin};
    frame-src 'self' ${origin};
    style-src 'self' 'unsafe-inline';
">`}</pre>
          <div className="muted" style={{ fontSize: "0.8rem" }}>
            Replace <code>{origin}</code> with your actual server URL (the same as <code>data-api-base</code> in the embed code). The CSP prevents
            unauthorized scripts from running on your visitors&apos; browsers and blocks data exfiltration.
          </div>
        </div>
      </div>

      {!isCreate && (
      <div className="card">
        <h2>Widget preview</h2>
        <p className="muted">
          A live preview of the widget floats at the bottom of this page, exactly where
          it will sit on your site. Edit the fields above and it updates; click the bubble
          to open the panel. Position follows the <em>Panel position</em> setting.
        </p>
      </div>
      )}

      <div className="card">
        <h2>Anti-abuse guardrails</h2>
        <p className="muted">Setting a sensible budget will limit the cost you incur from a visitor abusing your chatbot.</p>
        <div className="form-row">
          <div className="field">
            <label className="label" htmlFor="dailyTokenBudget">Daily token budget</label>
            <input
              className="input"
              id="dailyTokenBudget"
              name="dailyTokenBudget"
              type="number"
              min="0"
              max="999999999"
              value={dailyBudget}
              onChange={(e) => setDailyBudget(e.target.value)}
            />
            <div className="muted" style={{ fontSize: "0.8rem" }}>
              Total amount of conversation the bot can have each day. <strong>100,000</strong>
              is plenty for most businesses. Enter <strong>0</strong> for no limit.
            </div>
          </div>
          <div className="field">
            <label className="label" htmlFor="rateLimitPerSession">Rate limit (per session / minute)</label>
            <input className="input" id="rateLimitPerSession" name="rateLimitPerSession" type="number" min="0" max="9999" defaultValue={n(chatbot.rate_limit_per_session ?? 30)} />
            <div className="muted" style={{ fontSize: "0.8rem" }}>
              How many messages one visitor can send per minute. <strong>30</strong>
              is enough for normal use. Enter <strong>0</strong> for no limit.
            </div>
          </div>
        </div>
        <div className="form-row">
          <div className="field">
            <label className="label" htmlFor="maxMessageLength">Max message length (characters)</label>
            <input className="input" id="maxMessageLength" name="maxMessageLength" type="number" min="0" max="100000" defaultValue={n(chatbot.max_message_length)} />
            <div className="muted" style={{ fontSize: "0.8rem" }}>
              Reject messages longer than this many characters (including spaces). Leave blank for no limit.
              Set to e.g. <strong>2000</strong> to prevent token-wasting spam.
            </div>
          </div>
          <div className="field">
            <label className="label" htmlFor="maxMessagesPerConversation">Max messages per conversation</label>
            <input className="input" id="maxMessagesPerConversation" name="maxMessagesPerConversation" type="number" min="0" max="9999" defaultValue={n(chatbot.max_messages_per_conversation)} />
            <div className="muted" style={{ fontSize: "0.8rem" }}>
              Maximum number of messages a single conversation can hold. Leave blank for no limit.
              Set to e.g. <strong>50</strong> to cap long-running sessions.
            </div>
          </div>
        </div>

        <h3 style={{ fontSize: "1rem", marginBottom: "0.4rem", marginTop: "1rem" }}>Server ceilings (this installation)</h3>
        <p className="muted" style={{ fontSize: "0.8rem", marginTop: "-0.25rem" }}>
          These apply to every chatbot on this installation and cannot be raised here. Where both a
          ceiling and a per-chatbot limit apply, the stricter one wins.
        </p>
        <div className="form-row">
          <div className="field">
            <label className="label" htmlFor="rateLimitPerIp">
              Requests per minute per visitor IP{" "}
              <span className="muted" style={{ fontWeight: "normal" }}>
                (ceiling: {chatbot.rateCeilings?.maxPerIp ?? "—"})
              </span>
            </label>
            <input
              className="input"
              id="rateLimitPerIp"
              name="rateLimitPerIp"
              type="number"
              min="1"
              max={chatbot.rateCeilings?.maxPerIp}
              defaultValue={n(chatbot.rate_limit_per_ip ?? chatbot.rateCeilings?.maxPerIp)}
            />
            <div className="muted" style={{ fontSize: "0.8rem" }}>
              Caps requests from one network address, however many sessions they open. This is the limit a
              script cannot dodge, because the address is set by the network rather than by the sender.
              Lower it if one visitor floods you.
            </div>
          </div>
          <div className="field">
            <label className="label" htmlFor="rateLimitPerToken">
              Requests per minute for this chatbot{" "}
              <span className="muted" style={{ fontWeight: "normal" }}>
                (ceiling: {chatbot.rateCeilings?.maxPerToken ?? "—"})
              </span>
            </label>
            <input
              className="input"
              id="rateLimitPerToken"
              name="rateLimitPerToken"
              type="number"
              min="1"
              max={chatbot.rateCeilings?.maxPerToken}
              defaultValue={n(chatbot.rate_limit_per_token ?? chatbot.rateCeilings?.maxPerToken)}
            />
            <div className="muted" style={{ fontSize: "0.8rem" }}>
              Caps total requests to this chatbot across all visitors. Protects the app and your API bill
              from a flood (a busy campaign, or someone reusing your widget token — it is public, so it is
              a volume ceiling, not a secret).
            </div>
          </div>
        </div>
      </div>

      <div className="form-actions" style={{ alignItems: "center", flexWrap: "wrap" }}>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={busy}
          style={justSaved ? { background: "var(--success)", borderColor: "var(--success)" } : undefined}
        >
          {busy ? (isCreate ? "Creating…" : "Saving…") : isCreate ? "Create chatbot" : justSaved ? "Saved ✓" : "Save changes"}
        </button>
        <Link href="/chatbots" className="btn">Cancel</Link>
        {msg && (
          <div
            className={`alert ${msg.kind === "ok" ? "alert-success" : "alert-error"}`}
            style={{ marginBottom: 0, padding: "0.45rem 0.75rem" }}
            role="status"
            aria-live="polite"
          >
            {msg.text}
          </div>
        )}
      </div>

      {!isCreate && (
      <WidgetPreview
        primaryColor={style.primaryColor}
        headerTextColor={style.headerTextColor}
        headerGradientTo={style.headerGradientTo}
        accentColor={style.accentColor}
        headerIcon={style.headerIcon}
        headerSubtitle={style.headerSubtitle}
        placeholderIcon={style.placeholderIcon}
        placeholderTitle={style.placeholderTitle}
        placeholderText={style.placeholderText}
        position={style.position}
        botName={style.botName}
        panelTheme={style.panelTheme}
      />
      )}
    </form>
  );
}