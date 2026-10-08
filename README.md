# JS Chatbot Assistant

**A free chatbot you run on your own server.** Upload your documents, train a bot on them, and paste one line of code into your website. Visitors ask questions, and the bot answers using your documents. Feature-identical to the PHP version, built in **Next.js (App Router) + TypeScript + Node.js**.

- Free and open source (MIT license)
- You host it, so your data stays with you
- No subscription and no account with us

## What it costs

The software itself costs **$0**. Download it, use it for anything, change it however you like.

The only things you may ever pay for:

| Thing | Who you pay |
|---|---|
| The software | Nobody — it's free |
| An AI provider account (powers the bot's answers) | Your provider, at their normal prices |
| A LlamaCloud key (reads your PDF and Word files) | LlamaCloud, at their normal prices |
| A server to run it on | Your hosting company |

Provider accounts are **yours**, opened directly with **them**. We never resell their services and never see your bills.

## What it does

- **Many chatbots.** Make as many as you want. Each one has its own name, colors, personality and settings.
- **Answers from your documents.** Upload PDF, Word, TXT or Markdown files. The bot reads them and answers questions using what's in them.
- **Two ways to read documents.** Regular mode searches small pieces of text (fast and simple). PageIndex mode reads the document's table of contents like a person would (better for long manuals). You pick per chatbot.
- **Gets you leads.** The bot can ask visitors for their name, email and phone during the chat, then saves them for you.
- **Quick answers.** Set up ready-made replies for common questions. They're instant and free.
- **Safe to put on the internet.** Login protection, rate limits, spending caps, and each account can only see its own data — enforced by the database itself, not just the code.
- **Looks the way you want.** Light or dark theme, your colors, your bot name. It won't clash with your website's styles.
- **A dashboard.** See how many conversations and messages you've had, with a bar chart of the last 7, 30 or 90 days.

## Add it to your website

One script tag. The chatbot page builds it for you with your colors already set:

```html
<script src="https://example.com/widget.js"
        data-widget-token="YOUR_WIDGET_TOKEN"
        data-api-base="https://example.com"
        data-bot-name="Support"
        data-primary-color="#2563eb"
        data-position="bottom-right"
        data-widget-theme="light"></script>
```

Paste it into your site before `</body>`. You also list which domains are allowed to use it, so nobody can steal the snippet for their own site.

## How to install it

You need Node.js 20+ and PostgreSQL 16 with the `pgvector` extension.

**1. Download the code**

```bash
git clone <this-repo>
cd js-chatbot-assistant
npm install
```

**2. Create the database and its two users**

```bash
sudo -u postgres psql << 'SQL'
CREATE ROLE chatbot_migrator LOGIN PASSWORD 'your-migrator-password';
CREATE ROLE chatbot_user LOGIN PASSWORD 'your-app-password';
CREATE DATABASE chatbot_assistant OWNER chatbot_migrator;
SQL
```

The migrator owns the tables; the app user is what the website logs in as. This split is **required** — it keeps each customer's data locked away from the others.

**3. Create the tables**

```bash
cp .env.example .env
nano .env            # fill in the DB_* values, including the two roles
npm run migrate      # runs as the migrator, grants the app user
```

`npm run migrate` refuses to run without the migrator role. `npm run migrate -- --fresh` drops all tables and rebuilds.

**Starting over?** To wipe everything and begin again, do the drop AND the recreate — dropping alone leaves nothing for the next run to connect with:

```bash
sudo -u postgres psql << 'SQL'
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='chatbot_assistant' AND pid <> pg_backend_pid();
DROP DATABASE IF EXISTS chatbot_assistant;
DROP ROLE IF EXISTS chatbot_user;
DROP ROLE IF EXISTS chatbot_migrator;
SQL
```

…then re-run steps 2 and 3 above.

**4. Start the app and the worker**

```bash
npm run dev          # or: npm run build && npm run start
npm run worker       # separate terminal — processes document training
```

**5. Register and add your keys**

Open http://example.com:3000, register, log in, open Settings, and add your AI provider accounts.

**6. Create a chatbot**

Pick an industry preset (or write your own instructions), upload a document, wait for training to finish, then copy the snippet onto your website.

**Check the security setup** (optional): every table should show `rowsecurity = yes` and be owned by the migrator, not the app user:

```bash
PGPASSWORD='your-app-password' psql -h 127.0.0.1 -U chatbot_user -d chatbot_assistant -c \
  "SELECT tablename, rowsecurity, force_rls FROM pg_tables WHERE schemaname='chatbot_schema';"
```

## Configuring your own AI models

In Settings, add any AI model you want by giving it a name, an API key, and a URL — OpenAI, OpenRouter, or your own self-hosted model. Then each chatbot picks one of those models, with an automatic backup model if the first one fails.

## Keeping the bot under control

Every chatbot has guardrails you can set:

- A limit on messages per minute
- A daily spending cap (token budget)
- A maximum message length
- A maximum number of messages per conversation
- Detection of trick prompts ("ignore your instructions and...")

Anything blocked this way costs you nothing, and it all gets logged.

## What's inside

```
js-chatbot-assistant/
├── public/          ← the embeddable widget (widget.js)
└── src/             ← the application code (Next.js app + worker)
```

Built with Next.js 15 (App Router), TypeScript (strict), PostgreSQL 16 with pgvector, and a small JavaScript widget. A Dockerfile and `docker-compose.yml` are included — see `docs/deploy.md`.

## Tests

From the repository root:

```bash
npm test                 # full suite (unit + integration)
```

420 tests, all running with LLM/embedding/parsing/SMTP behind injectable interfaces, so nothing outside your computer is contacted.

## Settings file

The app reads its settings from `.env` (validated with `zod`). Copy `.env.example` to `.env` and fill in your values:

| Setting | Default | What it is |
|---|---|---|
| `DB_HOST` | `127.0.0.1` | Database server address |
| `DB_PORT` | `5432` | Database port |
| `DB_NAME` | `chatbot_assistant` | Database name |
| `DB_SCHEMA` | `chatbot_schema` | Database schema |
| `DB_USER` | `chatbot_user` | Database user the app logs in as |
| `DB_PASS` | (none) | Database password |
| `DB_MIGRATOR_USER` | (none) | Owner role for migrations (two-role RLS). Required |
| `DB_MIGRATOR_PASS` | (none) | Its password |
| `APP_ENV` | `production` | `production` or `development` |
| `APP_URL` | `https://example.com` | Your site's address (used in emails; `https://` also turns on Secure cookies and HSTS) |
| `ALLOW_REGISTRATION` | `true` | Whether new accounts can register |
| `APP_ENCRYPTION_KEY` | (none) | Encrypts secrets the app must read back (the MFA seed). Required in production — `openssl rand -hex 32` |
| `TRUSTED_PROXY_HOPS` | `0` | How many reverse proxies may be trusted for `X-Forwarded-For` |
| `PUBLIC_CHAT_RATE_MAX` | `120` | Server ceiling for the public widget chat endpoint, per visitor IP per window |
| `PUBLIC_CHAT_TOKEN_RATE_MAX` | `300` | Server ceiling per widget token per window |
| `PUBLIC_CHAT_RATE_WINDOW` | `60` | Rate limit window in seconds |
| `ALLOW_PRIVATE_PROVIDER_URLS` | `false` | Allow provider URLs to point at private/loopback hosts, for a self-hosted LLM |
| `STORAGE_DIR` | `storage/uploads` | Where uploaded files are written |
| `SESSION_COOKIE_NAME` | `chatbot_session` | Session cookie name |
| `SESSION_LIFETIME` | `1440` | Minutes before idle users are logged out |
| `SMTP_HOST` | `localhost` | Mail server for sending email |
| `SMTP_PORT` | `587` | Mail server port |
| `SMTP_AUTH` | `true` | Does the mail server need a login? |
| `SMTP_USER` | (none) | Mail username |
| `SMTP_PASS` | (none) | Mail password |
| `SMTP_ENCRYPTION` | `starttls` | Mail encryption type |
| `MAIL_FROM_ADDRESS` | `noreply@example.com` | From address for outgoing email |
| `MAIL_FROM_NAME` | `Chatbot Assistant` | From name for outgoing email |

API keys are per-account and entered in the Settings screen, so they stay on the `users` table rather than in a shared `.env`.

## Common questions

**Is this a subscription service?**
No. It's software you download and run yourself. Nothing is hosted by us and nothing bills through us.

**Where does my data live?**
In your own database, on your own server. The only outside calls are to the AI providers you configure and your own mail server.

**Which mode should I pick for my documents?**
Start with the regular vector search — it's fast and works well for most sites. Use PageIndex for long documents with clear headings, like manuals and reports. You can try both and compare.

**How is this different from the PHP version?**
It isn't, functionally — same features, same PostgreSQL schema, same widget and public API contract. The differences are the stack (Next.js/TypeScript instead of PHP) and that document training runs in a background worker instead of during the request.

## Security assessment

The codebase is regularly scanned with three independent tools — static analysis, a live attack proxy, and dependency/secret scanning. The latest run came back clean:

| Scanner | What it checks | Result |
|---|---|---|
| Semgrep (SAST) | Static code analysis — injection, secrets, unsafe patterns | 0 findings |
| OWASP ZAP (DAST) | Live full-scan — XSS, SQLi, headers, session handling | 0 failures (warnings fixed) |
| Trivy | Dependencies, secrets, misconfigurations | 0 findings |
| Vitest | 420 tests — auth, rate limiting, retrieval, RLS isolation, XSS sanitization | 420 pass |

Commands used (from the repository root):

```bash
# Static analysis
semgrep scan --metrics=off --config p/default --config p/typescript --config p/security-audit --config p/secrets

# Live dynamic scan against a running instance (full scan, report to zap-report.html)
docker run --rm --network host -v "$(pwd)":/zap/wrk:rw -t ghcr.io/zaproxy/zaproxy:stable \
  zap-full-scan.py -t http://example.com:3000 -r zap-report.html

# Dependency, secret and misconfiguration scan
trivy fs --scanners vuln,secret,misconfig --severity HIGH,CRITICAL .

# Unit tests
npm test
```

## Deployment

See `docs/deploy.md`. A `Dockerfile` and `docker-compose.yml` (app + PostgreSQL/pgvector + worker) are included.

## License

MIT.
---

# Addendum: Running behind a reverse proxy as a systemd service

This addendum covers a bare-metal (non-Docker) deployment: the app runs under
a process manager, and Apache or Nginx sits in front of it handling TLS on
ports 80/443. Instructions are given for AlmaLinux (RHEL family) and Ubuntu
(Debian family).

## 1. Run the app as a dedicated service (systemd)

Create a dedicated user (do not run the app as root):

```bash
# AlmaLinux
sudo useradd --system --home /opt/chatbot --shell /sbin/nologin chatbot

# Ubuntu
sudo useradd --system --home /opt/chatbot --shell /usr/sbin/nologin chatbot
```

Put the application in `/opt/chatbot`, install dependencies and build:

```bash
cd /opt/chatbot
sudo -u chatbot npm ci
sudo -u chatbot npm run build
```

Make sure `.env` exists in that directory and is readable only by the service
user (`chmod 600 .env`).

Create `/etc/systemd/system/chatbot.service`:

```ini
[Unit]
Description=Chatbot Assistant (Next.js)
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=chatbot
Group=chatbot
WorkingDirectory=/opt/chatbot
Environment=NODE_ENV=production
Environment=PORT=3000
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=5
# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=/opt/chatbot

[Install]
WantedBy=multi-user.target
```

> If Node was installed via nvm or a version manager, replace `/usr/bin/npm`
> with the absolute path to `npm` (`which npm` as the service user). A missing
> absolute path is the most common cause of "status=203/EXEC" on startup.

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now chatbot.service
sudo systemctl status chatbot.service
```

The background document-training worker runs as a second service. Create
`/etc/systemd/system/chatbot-worker.service` with the same shape, changing
`Description`, adding `Requires=chatbot.service` and `After=chatbot.service`,
and using the worker start command:

```ini
ExecStart=/usr/bin/npm run worker
```

Enable it the same way (`daemon-reload`, `enable --now`). Check logs with
`journalctl -u chatbot -f` (and `-u chatbot-worker -f`).

The app now listens on `127.0.0.1:3000`. Set `APP_URL` in `.env` to the public
address people visit (e.g. `https://chatbot.example.com`) — it is used in
emails, secure-cookie behaviour and the widget embed snippet. Do not expose
port 3000 publicly; let the proxy handle 80/443.

## 2. Nginx reverse proxy

### AlmaLinux

```bash
sudo dnf install nginx
sudo systemctl enable --now nginx
# Allow web ports in the firewall
# firewalld (AlmaLinux default):
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
# ufw (if the host uses ufw instead of firewalld):
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw reload
# SELinux: allow nginx to make outbound connections to the app
sudo setsebool -P httpd_can_network_connect 1
```

### Ubuntu

```bash
sudo apt install nginx
sudo systemctl enable --now nginx
# ufw usually allows 80/443 with: sudo ufw allow 'Nginx Full'
```

Create `/etc/nginx/conf.d/chatbot.conf` (AlmaLinux) or
`/etc/nginx/sites-available/chatbot` + a symlink into
`/etc/nginx/sites-enabled/` (Ubuntu):

```nginx
server {
    listen 80;
    server_name chatbot.example.com;

    # Larger uploads for document files
    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}
```

Test and reload:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### TLS with Let's Encrypt

```bash
# AlmaLinux
sudo dnf install certbot python3-certbot-nginx

# Ubuntu
sudo apt install certbot python3-certbot-nginx

sudo certbot --nginx -d chatbot.example.com
```

Certbot rewrites the server block to listen on 443 and adds a redirect from
port 80. Certificates renew automatically (a systemd timer is installed).

## 3. Apache reverse proxy

### AlmaLinux

```bash
sudo dnf install httpd
sudo systemctl enable --now httpd
# firewalld (AlmaLinux default):
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
# ufw (if the host uses ufw instead of firewalld):
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw reload
# SELinux: allow Apache to make outbound connections to the app
sudo setsebool -P httpd_can_network_connect 1
```

Enable the proxy modules:

```bash
sudo tee /etc/httpd/conf.modules.d/00-proxy.conf.d/chatbot.conf > /dev/null <<'EOF'
LoadModule proxy_module modules/mod_proxy.so
LoadModule proxy_http_module modules/mod_proxy_http.so
EOF
```

(On recent AlmaLinux these modules are already loaded; the file above is
harmless if so.)

### Ubuntu

```bash
sudo apt install apache2
sudo systemctl enable --now apache2
sudo a2enmod proxy proxy_http headers rewrite
```

Create the virtual host — `/etc/httpd/conf.d/chatbot.conf` (AlmaLinux) or
`/etc/apache2/sites-available/chatbot.conf` (Ubuntu, then
`sudo a2ensite chatbot`):

```apache
<VirtualHost *:80>
    ServerName chatbot.example.com

    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:3000/
    ProxyPassReverse / http://127.0.0.1:3000/
    RequestHeader set X-Forwarded-Proto "http"

    # Larger uploads for document files
    LimitRequestBody 52428800
</VirtualHost>
```

On Ubuntu, enable the site and reload; on AlmaLinux just reload:

```bash
# Ubuntu
sudo a2ensite chatbot
sudo systemctl reload apache2

# AlmaLinux
sudo systemctl reload httpd
```

### TLS with Let's Encrypt

```bash
# AlmaLinux
sudo dnf install certbot python3-certbot-apache
sudo certbot --apache -d chatbot.example.com

# Ubuntu
sudo apt install certbot python3-certbot-apache
sudo certbot --apache -d chatbot.example.com
```

Certbot rewrites the virtual host to include the :443 block and the HTTP→HTTPS
redirect.

## 4. Post-proxy checklist

- **Trusted client IP.** The app reads `X-Forwarded-For` for rate limiting. If
  the proxy runs on the same machine (it does in this setup), set
  `TRUSTED_PROXY_HOPS=1` in `.env` so the app trusts exactly one proxy hop and
  rate-limits the real visitor address rather than the proxy's. Count one hop
  per proxy in front of the app.
- **APP_URL.** Set it to the public HTTPS address (`https://chatbot.example.com`).
  With `https://` the app enables Secure cookies and HSTS automatically.
- **Widget embeds.** The embed snippet shown on the chatbot page uses your
  server address; the customer site's origin must be listed in the chatbot's
  Allowed domains (Domain security section), or the widget's chat calls are
  rejected with 403.
- **Node upgrade path.** After rebuilding (`npm ci && npm run build`), restart
  with `sudo systemctl restart chatbot chatbot-worker`.
