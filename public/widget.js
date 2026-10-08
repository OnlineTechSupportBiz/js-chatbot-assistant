/**
 * Chatbot Assistant Embed Widget
 *
 * Usage:
 *   <script src="https://example.com/widget.js"
 *           data-widget-token="YOUR_WIDGET_TOKEN"
 *           data-api-base="https://example.com"
 *           data-bot-name="Assistant"
 *           data-primary-color="#2563eb"
 *           data-header-gradient-to="#1d4ed8"
 *           data-accent-color="#7c3aed"
 *           data-header-icon="💬"
 *           data-header-subtitle="Online"
 *           data-placeholder-icon=""
 *           data-placeholder-title=""
 *           data-placeholder-text="Ask me anything!"
 *           data-header-text-color="#ffffff"
 *           data-widget-theme="light"
 *           data-position="bottom-right"></script>
 *
 * The widget auto-appends a chat bubble to the page body.
 * Session persistence: visitor_session_id is stored in localStorage.
 */
(function () {
    'use strict';

    // ── Configuration ─────────────────────────────────────────────────────
    var script = document.currentScript || document.querySelector('script[data-widget-token]');
    if (!script) return;

    var WIDGET_TOKEN       = script.getAttribute('data-widget-token');
    var API_BASE           = script.getAttribute('data-api-base') || window.location.origin;
    var BOT_NAME           = script.getAttribute('data-bot-name') || 'Assistant';
    var HEADER_SUBTITLE    = script.getAttribute('data-header-subtitle') || '';
    var HEADER_ICON        = script.getAttribute('data-header-icon') || '';
    var PLACEHOLDER_ICON   = script.getAttribute('data-placeholder-icon') || '';
    var PLACEHOLDER_TITLE  = script.getAttribute('data-placeholder-title') || '';
    var PLACEHOLDER_TEXT   = script.getAttribute('data-placeholder-text') || 'Ask me anything!';
    var PRIMARY_COLOR      = script.getAttribute('data-primary-color') || '#2563eb';
    var HEADER_GRADIENT_TO = script.getAttribute('data-header-gradient-to') || '';
    var HEADER_TEXT_COLOR  = script.getAttribute('data-header-text-color') || '#ffffff';
    var ACCENT_COLOR       = script.getAttribute('data-accent-color') || '';
    var POSITION           = script.getAttribute('data-position') || 'bottom-right';
    var WIDGET_THEME       = script.getAttribute('data-widget-theme') || 'light';

    // Resolve derived values
    var FINAL_ACCENT = ACCENT_COLOR || PRIMARY_COLOR;
    var headerBg = HEADER_GRADIENT_TO
        ? 'linear-gradient(135deg, ' + PRIMARY_COLOR + ', ' + HEADER_GRADIENT_TO + ')'
        : PRIMARY_COLOR;

    // ── Persisted panel size (drag-resize) ────────────────────────────────
    var RESIZE_KEY = 'chatbot_panel_size';
    var savedSize = localStorage.getItem(RESIZE_KEY);
    var panelWidth, panelHeight;
    if (savedSize) {
        try {
            var dims = JSON.parse(savedSize);
            panelWidth = Math.min(Math.max(parseInt(dims.w, 10) || 360, 260), 600);
            panelHeight = Math.min(Math.max(parseInt(dims.h, 10) || 520, 360), 800);
        } catch {
            panelWidth = 360; panelHeight = 520;
        }
    } else {
        panelWidth = 360; panelHeight = 520;
    }

    if (!WIDGET_TOKEN) {
        console.error('[Chatbot Widget] Missing data-widget-token attribute');
        return;
    }

    // ── Load marked (markdown → HTML) ────────────────────────────────────
    (function () {
        if (typeof window.marked !== 'undefined') return;
        var s = document.createElement('script');
        // Pinned version + Subresource Integrity: a compromised or MITM'd CDN
        // cannot substitute the parser in the embedding customer's page. If the
        // hash ever fails to match, the browser refuses the script and the widget
        // falls back to plain text (see addMessage) rather than rendering HTML.
        s.src = 'https://cdn.jsdelivr.net/npm/marked@15.0.12/marked.min.js';
        s.integrity = 'sha384-948ahk4ZmxYVYOc+rxN1H2gM1EJ2Duhp7uHtZ4WSLkV4Vtx5MUqnV+l7u9B+jFv+';
        s.crossOrigin = 'anonymous';
        document.head.appendChild(s);
    })();

    var API_URL = API_BASE + '/api/public/chat';

    // ── Session ID ────────────────────────────────────────────────────────
    var STORAGE_KEY = 'chatbot_assistant_session';
    function getSessionId() {
        var sid = localStorage.getItem(STORAGE_KEY);
        if (!sid) {
            sid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
                var r = Math.random() * 16 | 0;
                return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
            });
            localStorage.setItem(STORAGE_KEY, sid);
        }
        return sid;
    }

    // ── DOM helpers ───────────────────────────────────────────────────────
    function createElement(tag, attrs, children) {
        var el = document.createElement(tag);
        for (var key in attrs) {
            if (key === 'style') {
                el.style.cssText = attrs[key];
            } else if (key === 'class') {
                el.className = attrs[key];
            } else {
                el.setAttribute(key, attrs[key]);
            }
        }
        if (children) {
            (Array.isArray(children) ? children : [children]).forEach(function (c) {
                if (typeof c === 'string') { el.appendChild(document.createTextNode(c)); }
                else if (c) { el.appendChild(c); }
            });
        }
        return el;
    }

    function escapeHtml(text) {
        var d = document.createElement('div');
        d.textContent = text;
        return d.innerHTML;
    }

    function getPositionStyles() {
        if (POSITION === 'bottom-left') {
            return { bottom: '20px', left: '20px', right: 'auto' };
        }
        return { bottom: '20px', right: '20px', left: 'auto' };
    }

    // ── Theme colors (light / dark) ───────────────────────────────────────
    var PANEL = WIDGET_THEME === 'dark'
        ? { bg: '#111d35', bodyBg: '#0a1628', footerBg: '#111d35', border: 'rgba(255,255,255,0.08)', inputBg: 'rgba(255,255,255,0.04)', inputColor: '#e8edf5', inputBorder: 'rgba(255,255,255,0.12)', placeholder: '#5a6d8a', scrollTrack: '#0a1628', scrollThumb: '#1a2d4a' }
        : { bg: '#ffffff', bodyBg: '#f5f7fa', footerBg: '#ffffff', border: 'rgba(0,0,0,0.08)', inputBg: '#f0f2f5', inputColor: '#1a1a2e', inputBorder: 'rgba(0,0,0,0.12)', placeholder: '#8899b4', scrollTrack: '#f0f2f5', scrollThumb: '#c0c8d4' };
    var BOT_MSG = WIDGET_THEME === 'dark'
        ? { bg: '#1a2d4a', color: '#e8edf5', chipBg: '#1a2d4a', chipColor: '#e8edf5', chipBorder: 'rgba(255,255,255,0.12)', chipHover: '#23456e' }
        : { bg: '#e9ecef', color: '#1a1a2e', chipBg: '#e9ecef', chipColor: '#1a1a2e', chipBorder: 'rgba(0,0,0,0.12)', chipHover: '#d0d5dc' };
    var host = document.createElement('div');
    host.id = 'chatbot-widget';
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;' +
        'bottom:' + getPositionStyles().bottom + ';' +
        'right:' + getPositionStyles().right + ';' +
        'left:' + getPositionStyles().left + ';' +
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;';

    var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;

    // Styles
    var style = document.createElement('style');
    style.textContent = [
        '* { box-sizing: border-box; margin: 0; padding: 0; }',
        '.chat-bubble {',
        '  width: 60px; height: 60px; border-radius: 50%;',
        '  background: ' + PRIMARY_COLOR + ';',
        '  color: #fff; border: none; cursor: pointer;',
        '  display: flex; align-items: center; justify-content: center;',
        '  box-shadow: 0 4px 12px rgba(0,0,0,0.2);',
        '  transition: transform 0.2s;',
        '}',
        '.chat-bubble:hover { transform: scale(1.1); }',
        '.chat-bubble svg { width: 28px; height: 28px; fill: #fff; }',
        '.chat-panel {',
        '  width: ' + (panelWidth || 360) + 'px; height: ' + (panelHeight || 520) + 'px; border-radius: 16px;',
        '  background: ' + PANEL.bg + '; border: 1px solid ' + PANEL.border + '; box-shadow: 0 8px 32px rgba(0,0,0,0.4);',
        '  display: none; flex-direction: column; overflow: hidden; position: absolute; bottom: 72px;',
        '  ' + (POSITION === 'bottom-left' ? 'left: 0;' : 'right: 0;'),
        '}',
        '.chat-panel.open { display: flex; }',
        // ── Header ───────────────────────────────────────────────────────
        '.chat-header {',
        '  background: ' + headerBg + '; color: ' + HEADER_TEXT_COLOR + ';',
        '  padding: 12px 16px; display: flex; align-items: center; justify-content: space-between; gap: 10px;',
        '  border-bottom: 3px solid ' + FINAL_ACCENT + ';',
        '}',
        '.header-left { display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1; }',
        '.header-icon {',
        '  width: 36px; height: 36px; border-radius: 50%;',
        '  background: rgba(0,0,0,0.2);',
        '  display: flex; align-items: center; justify-content: center;',
        '  font-size: 18px; line-height: 1; flex-shrink: 0;',
        '}',
        '.header-text { display: flex; flex-direction: column; min-width: 0; }',
        '.header-title { font-weight: 600; font-size: 15px; line-height: 1.3; }',
        '.header-subtitle { font-size: 11px; opacity: 0.8; line-height: 1.3; margin-top: 1px; }',
        '.chat-close { background: none; border: none; color: ' + HEADER_TEXT_COLOR + '; cursor: pointer; font-size: 20px; opacity: 0.8; flex-shrink: 0; }',
        '.chat-close:hover { opacity: 1; }',
        // ── Body ─────────────────────────────────────────────────────────
        '.chat-body { flex: 1; overflow-y: auto; padding: 12px; background: ' + PANEL.bodyBg + '; }',
        '.message { margin-bottom: 10px; display: flex; }',
        '.message.user { justify-content: flex-end; }',
        '.message.bot { justify-content: flex-start; }',
        '.message-text {',
        '  max-width: 80%; padding: 8px 14px; border-radius: 16px;',
        '  font-size: 14px; line-height: 1.55; word-wrap: break-word;',
        '}',
        '.message.user .message-text {',
        '  background: ' + PRIMARY_COLOR + '; color: #fff;',
        '  border-bottom-right-radius: 4px; white-space: pre-wrap;',
        '}',
        // Markdown styles for bot messages
        '.message.bot .message-text p { margin-bottom: 6px; }',
        '.message.bot .message-text p:last-child { margin-bottom: 0; }',
        '.message.bot .message-text ul, .message.bot .message-text ol { padding-left: 18px; margin-bottom: 6px; }',
        '.message.bot .message-text li { margin-bottom: 2px; }',
        '.message.bot .message-text pre { background: rgba(0,0,0,0.25); border-radius: 6px; padding: 8px 12px; overflow-x: auto; margin-bottom: 6px; font-size: 13px; }',
        '.message.bot .message-text code { font-family: Consolas, Monaco, "Courier New", monospace; font-size: 0.9em; background: rgba(0,0,0,0.2); padding: 1px 5px; border-radius: 3px; }',
        '.message.bot .message-text pre code { background: none; padding: 0; }',
        '.message.bot .message-text blockquote { border-left: 3px solid ' + FINAL_ACCENT + '; padding-left: 10px; opacity: 0.8; margin-bottom: 6px; }',
        '.message.bot .message-text table { border-collapse: collapse; margin-bottom: 6px; width: 100%; font-size: 13px; }',
        '.message.bot .message-text th, .message.bot .message-text td { border: 1px solid ' + PANEL.border + '; padding: 4px 8px; text-align: left; }',
        '.message.bot .message-text th { font-weight: 600; background: rgba(0,0,0,0.1); }',
        '.message.bot .message-text a { color: ' + FINAL_ACCENT + '; text-decoration: underline; }',
        '.message.bot .message-text h1, .message.bot .message-text h2, .message.bot .message-text h3,',
        '.message.bot .message-text h4, .message.bot .message-text h5, .message.bot .message-text h6 { margin-bottom: 4px; font-weight: 600; }',
        '.message.bot .message-text hr { border: none; border-top: 1px solid ' + PANEL.border + '; margin: 8px 0; }',
        '.chat-body::-webkit-scrollbar { width: 6px; }',
        '.chat-body::-webkit-scrollbar-track { background: ' + PANEL.scrollTrack + '; }',
        '.chat-body::-webkit-scrollbar-thumb { background: ' + PANEL.scrollThumb + '; border-radius: 3px; }',
        '.message.bot .message-text {',
        '  background: ' + BOT_MSG.bg + '; color: ' + BOT_MSG.color + ';',
        '  border-bottom-left-radius: 4px;',
        '}',
        // ── Footer ───────────────────────────────────────────────────────
        '.chat-footer { padding: 10px 12px; border-top: 1px solid ' + PANEL.border + '; background: ' + PANEL.footerBg + '; display: flex; gap: 8px; }',
        '.chat-footer input {',
        '  flex: 1; border: 1px solid ' + PANEL.inputBorder + '; border-radius: 20px; padding: 8px 14px;',
        '  background: ' + PANEL.inputBg + '; color: ' + PANEL.inputColor + '; font-size: 14px; outline: none;',
        '}',
        '.chat-footer input::placeholder { color: ' + PANEL.placeholder + '; }',
        '.chat-footer input:focus { border-color: ' + FINAL_ACCENT + '; }',
        '.chat-send {',
        '  background: ' + FINAL_ACCENT + '; color: #fff; border: none;',
        '  border-radius: 50%; width: 36px; height: 36px; cursor: pointer;',
        '  display: flex; align-items: center; justify-content: center;',
        '  font-size: 18px; line-height: 1;',
        '}',
        '.chat-send svg { width: 18px; height: 18px; display: block; }',
        '.chat-send:disabled { opacity: 0.5; cursor: not-allowed; }',
        '.chat-typing { font-size: 13px; color: #8899b4; padding: 4px 12px 8px; }',
        // ── Placeholder ──────────────────────────────────────────────────
        '.chat-placeholder { text-align: center; color: ' + PANEL.placeholder + '; padding: 40px 20px 20px; }',
        '.placeholder-icon { font-size: 36px; line-height: 1; margin-bottom: 10px; opacity: 0.6; }',
        '.placeholder-title { font-weight: 600; font-size: 15px; color: ' + (WIDGET_THEME === 'dark' ? '#d0d8e0' : '#2c3e50') + '; margin-bottom: 4px; }',
        '.placeholder-text { font-size: 14px; line-height: 1.5; }',
        // ── Quick answers ────────────────────────────────────────────────
        '.quick-answer-chips { padding: 0 12px 12px; display: flex; flex-wrap: wrap; gap: 8px; }',
        '.quick-answer-chips .qa-chip {',
        '  background: ' + BOT_MSG.chipBg + '; color: ' + BOT_MSG.chipColor + '; border: 1px solid ' + BOT_MSG.chipBorder + ';',
        '  border-radius: 16px; padding: 6px 14px; font-size: 13px; cursor: pointer;',
        '  transition: background 0.15s, border-color 0.15s; line-height: 1.3;',
        '}',
        '.quick-answer-chips .qa-chip:hover {',
        '  background: ' + BOT_MSG.chipBg + '; border-color: ' + FINAL_ACCENT + ';',
        '}',
        '.error-text { color: #dc3545; font-size: 13px; }',
        // ── Rating bar ─────────────────────────────────────────────────
        '.rating-bar {',
        '  position: relative; bottom: 0;',
        '  ' + (POSITION === 'bottom-left' ? 'left: 0; right: auto;' : 'right: 0; left: auto;'),
        '  width: ' + (panelWidth || 360) + 'px;',
        '  background: ' + PANEL.bg + ';',
        '  border: 2px solid ' + FINAL_ACCENT + ';',
        '  border-radius: 16px 16px 0 0;',
        '  box-shadow: 0 -4px 16px rgba(0,0,0,0.15);',
        '  padding: 16px 36px 16px 16px; text-align: center;',
        '  transform: translateY(20px); opacity: 0;',
        '  transition: transform 0.3s ease, opacity 0.3s ease;',
        '  z-index: 2147483647;',
        '}',
        '.rating-close {',
        '  position: absolute; top: 6px; right: 10px;',
        '  background: none; border: none;',
        '  color: ' + PANEL.placeholder + '; cursor: pointer;',
        '  font-size: 20px; line-height: 1; padding: 2px;',
        '}',
        '.rating-close:hover { color: ' + (WIDGET_THEME === 'dark' ? '#e8edf5' : '#1a1a2e') + '; }',
        '.rating-text { font-size: 14px; font-weight: 600; color: ' + (WIDGET_THEME === 'dark' ? '#e8edf5' : '#1a1a2e') + '; margin-bottom: 8px; }',
        '.rating-stars { display: flex; justify-content: center; gap: 6px; margin-bottom: 6px; flex-direction: row-reverse; }',
        '.rating-stars .star {',
        '  font-size: 32px; line-height: 1; cursor: pointer;',
        '  color: ' + (WIDGET_THEME === 'dark' ? '#4a5d7a' : '#c0c8d4') + ';',
        '  transition: color 0.15s, transform 0.15s;',
        '  display: inline-block;',
        '}',
        '.rating-stars .star:hover,',
        '.rating-stars .star:hover ~ .star {',
        '  color: ' + FINAL_ACCENT + ';',
        '}',
        '.rating-stars .star:hover { transform: scale(1.2); }',
        '.rating-subtitle { font-size: 12px; color: ' + (WIDGET_THEME === 'dark' ? '#8899b4' : '#6b7d96') + '; line-height: 1.4; }',
    ].join('\n');
    root.appendChild(style);

    // ── UI Elements ─────────────────────────────────────────────────────
    var panel = createElement('div', { class: 'chat-panel' });

    // Header
    var headerLeft = createElement('div', { class: 'header-left' });
    if (HEADER_ICON) {
        headerLeft.appendChild(createElement('span', { class: 'header-icon' }, [HEADER_ICON]));
    }
    var headerTextEl = createElement('div', { class: 'header-text' });
    headerTextEl.appendChild(createElement('span', { class: 'header-title' }, [BOT_NAME]));
    if (HEADER_SUBTITLE) {
        headerTextEl.appendChild(createElement('span', { class: 'header-subtitle' }, [HEADER_SUBTITLE]));
    }
    headerLeft.appendChild(headerTextEl);

    var header = createElement('div', { class: 'chat-header' }, [
        headerLeft,
        createElement('button', { class: 'chat-close', 'aria-label': 'Close' }, ['\u00d7'])
    ]);
    panel.appendChild(header);

    // Body
    var body = createElement('div', { class: 'chat-body' });
    var placeholderChildren = [];
    if (PLACEHOLDER_ICON) {
        placeholderChildren.push(createElement('div', { class: 'placeholder-icon' }, [PLACEHOLDER_ICON]));
    }
    if (PLACEHOLDER_TITLE) {
        placeholderChildren.push(createElement('div', { class: 'placeholder-title' }, [PLACEHOLDER_TITLE]));
    }
    if (PLACEHOLDER_TEXT) {
        placeholderChildren.push(createElement('div', { class: 'placeholder-text' }, [PLACEHOLDER_TEXT]));
    }
    var placeholder = createElement('div', { class: 'chat-placeholder' },
        placeholderChildren.length > 0 ? placeholderChildren : ['Ask me anything!']
    );
    body.appendChild(placeholder);
    var qaContainer = createElement('div', { class: 'quick-answer-chips' });
    body.appendChild(qaContainer);
    panel.appendChild(body);

    var typing = createElement('div', { class: 'chat-typing' });
    panel.appendChild(typing);

    var footer = createElement('div', { class: 'chat-footer' });
    var input = createElement('input', { type: 'text', placeholder: 'Type a message...' });
    footer.appendChild(input);
    var sendBtn = createElement('button', { class: 'chat-send', 'aria-label': 'Send' });
    sendBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>';
    footer.appendChild(sendBtn);
    panel.appendChild(footer);

    // Chat bubble icon (SVG)
    var bubble = createElement('button', { class: 'chat-bubble', 'aria-label': 'Open chat' });
    bubble.innerHTML = '<svg viewBox="0 0 24 24" fill="#fff"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>';

    root.appendChild(bubble);
    root.appendChild(panel);
    document.body.appendChild(host);

    // ── State ─────────────────────────────────────────────────────────────
    var isOpen = false;
    var isLoading = false;
    var quickAnswersLoaded = false;
    var hasSentMessage = false;
    var lastActivity = Date.now();
    var ratingBar = null;

    // ── Chat logic ────────────────────────────────────────────────────────

    /**
     * Escape HTML metacharacters before the text reaches `marked`.
     *
     * `marked.parse()` passes raw HTML straight through, so without this the reply
     * — model output, tenant-authored quick-answer text, or retrieved document
     * content — lands in the embedding customer's page as live HTML and script
     * (innerHTML below). Markdown still renders; literal HTML in a reply no longer
     * does. Blockquote syntax (`> `) is escaped too, which is the accepted trade.
     */
    function escapeHtml(text) {
        return String(text === null || text === undefined ? '' : text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /**
     * Second pass: markdown can still build a link with a dangerous scheme
     * (`[x](javascript:...)`), which `marked` does not filter. Render into a
     * detached document and strip anything executable: event handlers, `style`,
     * and href/src values that are not http(s)/mailto/tel/anchor/relative.
     */
    function sanitizeHtml(html) {
        var doc = document.implementation.createHTMLDocument('');
        doc.body.innerHTML = html;
        var SAFE_URL = /^(https?:|mailto:|tel:|#|\/)/i;
        var nodes = doc.body.querySelectorAll('*');
        for (var i = 0; i < nodes.length; i++) {
            var attrs = nodes[i].attributes;
            for (var j = attrs.length - 1; j >= 0; j--) {
                var name = attrs[j].name.toLowerCase();
                var value = String(attrs[j].value || '');
                if (name.indexOf('on') === 0 || name === 'style' || name === 'srcdoc') {
                    nodes[i].removeAttribute(attrs[j].name);
                    continue;
                }
                if (name === 'href' || name === 'src' || name === 'xlink:href') {
                    // Control characters are ignored by browsers when resolving a
                    // scheme, so strip them before the check.
                    if (!SAFE_URL.test(value.replace(/[\u0000-\u0020]/g, ''))) {
                        nodes[i].removeAttribute(attrs[j].name);
                    }
                }
            }
        }
        return doc.body.innerHTML;
    }

    function addMessage(role, content) {
        var msg = createElement('div', { class: 'message ' + role });
        var textEl = createElement('div', { class: 'message-text' });
        if (role === 'user') {
            textEl.textContent = content;
        } else if (window.marked) {
            textEl.innerHTML = sanitizeHtml(window.marked.parse(escapeHtml(content)));
        } else {
            textEl.textContent = content;
        }
        msg.appendChild(textEl);
        body.appendChild(msg);
        body.scrollTop = body.scrollHeight;
    }

    function sendMessage(text) {
        if (isLoading || !text.trim()) return;
        isLoading = true;

        var sendBtn = footer.querySelector('.chat-send');
        sendBtn.disabled = true;
        input.value = '';
        typing.textContent = 'typing...';

        if (placeholder.parentNode) {
            placeholder.parentNode.removeChild(placeholder);
        }

        addMessage('user', text);

        var xhr = new XMLHttpRequest();
        xhr.open('POST', API_URL, true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.onload = function () {
            isLoading = false;
            sendBtn.disabled = false;
            typing.textContent = '';

            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    var data = JSON.parse(xhr.responseText);
                    if (data.error) {
                        addMessage('bot', 'Sorry, ' + data.error);
                    } else {
                        addMessage('bot', data.reply);
                    }
                } catch {
                    addMessage('bot', 'Sorry, an error occurred processing your request.');
                }
            } else {
                addMessage('bot', 'Sorry, an error occurred. Please try again later.');
            }

            input.focus();
        };
        xhr.onerror = function () {
            isLoading = false;
            sendBtn.disabled = false;
            typing.textContent = '';
            addMessage('bot', 'Connection error. Please check your internet and try again.');
            input.focus();
        };
        hasSentMessage = true;
        lastActivity = Date.now();

        xhr.send(JSON.stringify({
            widget_token: WIDGET_TOKEN,
            message: text,
            session_id: getSessionId()
        }));
    }

    // ── Quick answers (proactive suggestion chips) ────────────────────────
    function loadQuickAnswers() {
        if (quickAnswersLoaded) return;
        quickAnswersLoaded = true;

        var url = API_URL.replace('chat', 'quick-answers') + '?widget_token=' + encodeURIComponent(WIDGET_TOKEN);
        var xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.onload = function () {
            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    var qas = JSON.parse(xhr.responseText);
                    if (Array.isArray(qas) && qas.length > 0) {
                        qaContainer.innerHTML = '';
                        qas.forEach(function (qa) {
                            var chip = createElement('span', { class: 'qa-chip' }, [escapeHtml(qa.trigger)]);
                            chip.addEventListener('click', function () {
                                sendMessage(qa.trigger);
                            });
                            qaContainer.appendChild(chip);
                        });
                    }
                } catch {
                    // Silently fail — quick answers are non-critical
                }
            }
        };
        xhr.send();
    }

    // ── Event handlers ───────────────────────────────────────────────────
    bubble.addEventListener('click', function () {
        isOpen = !isOpen;
        panel.classList.toggle('open', isOpen);
        bubble.style.display = isOpen ? 'none' : 'flex';
        if (isOpen) {
            input.focus();
            loadQuickAnswers();
        }
    });

    header.querySelector('.chat-close').addEventListener('click', function () {
        isOpen = false;
        panel.classList.remove('open');
        bubble.style.display = 'flex';
        lastActivity = Date.now();
    });

    footer.querySelector('.chat-send').addEventListener('click', function () {
        sendMessage(input.value);
    });

    input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            sendMessage(input.value);
        }
    });

    // ── Drag resize (grab left or right edge of panel) ────────────────────
    var resizeData = null;
    var EDGE = 14; // px from edge to trigger resize

    function isNearEdge(e) {
        var rect = panel.getBoundingClientRect();
        var cx = e.clientX || (e.touches && e.touches[0].clientX);
        if (cx == null) return null;
        var nearRight = cx > rect.right - EDGE;
        var nearLeft = cx < rect.left + EDGE;
        return nearLeft ? 'left' : (nearRight ? 'right' : null);
    }

    // Cursor change on hover
    panel.addEventListener('mousemove', function (e) {
        panel.style.cursor = isNearEdge(e) ? 'ew-resize' : '';
    });

    panel.addEventListener('mouseleave', function () {
        panel.style.cursor = '';
    });

    panel.addEventListener('mousedown', function (e) {
        var edge = isNearEdge(e);
        if (!edge) return;
        e.preventDefault();
        var rect = panel.getBoundingClientRect();
        resizeData = { edge: edge, sx: e.clientX, w: rect.width };
    });

    panel.addEventListener('touchstart', function (e) {
        var edge = isNearEdge(e);
        if (!edge) return;
        var rect = panel.getBoundingClientRect();
        resizeData = { edge: edge, sx: e.touches[0].clientX, w: rect.width };
    }, { passive: true });

    function doResize(e) {
        if (!resizeData) return;
        var cx = e.clientX || (e.touches && e.touches[0].clientX);
        if (cx == null) return;

        var dx = resizeData.edge === 'left' ? resizeData.sx - cx : cx - resizeData.sx;
        var newW = Math.min(Math.max(resizeData.w + dx, 360), 600);

        panel.style.width = newW + 'px';
        panelWidth = newW;
    }

    function endResize() {
        if (!resizeData) return;
        resizeData = null;
        localStorage.setItem(RESIZE_KEY, JSON.stringify({ w: panelWidth, h: panelHeight }));
    }

    document.addEventListener('mousemove', doResize);
    document.addEventListener('mouseup', endResize);
    document.addEventListener('touchmove', doResize, { passive: true });
    document.addEventListener('touchend', endResize);

    // ── Rating prompt (2 min inactivity after a conversation) ──────────────
    var RATING_GIVEN_KEY = 'chatbot_rating_given';
    var RATE_URL = API_URL.replace('/chat', '/rate');

    // Periodic check: every 30 seconds, see if we should prompt for a rating
    setInterval(function () {
        if (!hasSentMessage) return;
        if (localStorage.getItem(RATING_GIVEN_KEY)) return;
        if (ratingBar) return;

        if (Date.now() - lastActivity >= 120000) { // 2 minutes
            // Close panel if open
            if (isOpen) {
                isOpen = false;
                panel.classList.remove('open');
                bubble.style.display = 'none';
            }
            showRatingBar();
        }
    }, 30000);

    function showRatingBar() {
        if (ratingBar) return;

        bubble.style.display = 'none';

        ratingBar = createElement('div', { class: 'rating-bar' });

        var closeBtn = createElement('button', { class: 'rating-close', 'aria-label': 'Close' }, ['\u00d7']);
        closeBtn.addEventListener('click', function () {
            hideRatingBar();
            bubble.style.display = 'flex';
        });
        ratingBar.appendChild(closeBtn);

        var text = createElement('div', { class: 'rating-text' }, ['How was your chat?']);
        ratingBar.appendChild(text);

        var stars = createElement('div', { class: 'rating-stars' });
        for (var i = 5; i >= 1; i--) {
            var star = createElement('span', { class: 'star', 'data-value': String(i) }, ['\u2605']);
            star._ratingValue = i;
            (function (val) {
                star.addEventListener('click', function () {
                    submitRating(val);
                });
            })(i);
            stars.appendChild(star);
        }
        ratingBar.appendChild(stars);

        var subtitle = createElement('div', { class: 'rating-subtitle' }, ['Tap a star to rate \u2014 takes a second']);
        ratingBar.appendChild(subtitle);

        root.appendChild(ratingBar);

        requestAnimationFrame(function () {
            ratingBar.style.transform = 'translateY(0)';
            ratingBar.style.opacity = '1';
        });
    }

    function submitRating(val) {
        if (isLoading) return;
        isLoading = true;

        var xhr = new XMLHttpRequest();
        xhr.open('POST', RATE_URL, true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.onload = function () {
            isLoading = false;
            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    var data = JSON.parse(xhr.responseText);
                    if (data.success) {
                        localStorage.setItem(RATING_GIVEN_KEY, '1');
                        hideRatingBar();
                    }
                } catch {}
            }
        };
        xhr.onerror = function () {
            isLoading = false;
        };
        xhr.send(JSON.stringify({
            widget_token: WIDGET_TOKEN,
            session_id: getSessionId(),
            rating: String(val)
        }));
    }

    function hideRatingBar() {
        if (!ratingBar) return;
        ratingBar.style.transform = 'translateY(20px)';
        ratingBar.style.opacity = '0';
        var el = ratingBar;
        setTimeout(function () {
            if (el.parentNode) {
                el.parentNode.removeChild(el);
            }
            bubble.style.display = 'flex';
        }, 300);
        ratingBar = null;
    }

})();
