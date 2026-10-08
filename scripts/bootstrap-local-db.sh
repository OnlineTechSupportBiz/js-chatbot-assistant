#!/usr/bin/env bash
#
# One-time database bootstrap.
#
# Creates the database, the two roles the RLS model needs, the schema and the
# pgvector extension, reusing the names and passwords already in .env. Equivalent
# to step 1 of INSTALL.md — see that file for the same SQL written out, and for
# what each statement is doing.
#
#   chmod +x scripts/bootstrap-local-db.sh
#   sudo ./scripts/bootstrap-local-db.sh
#   npm run migrate
#
# Needs to run as a user who can `sudo -u postgres`: pgvector is not a "trusted"
# extension, so installing it requires a real superuser. That is the only reason
# this cannot be a plain `npm` script.
#
# Safe to re-run — every step is guarded by an existence check.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "error: $ENV_FILE not found — copy .env.example to .env and fill it in first" >&2
  exit 1
fi

# Read a value out of .env without sourcing the file, so nothing else in it can
# execute code in this shell.
read_env() {
  local key="$1" line
  line="$(grep -E "^${key}=" "$ENV_FILE" | tail -n1 || true)"
  [[ -n "$line" ]] || { echo "error: $key is not set in .env" >&2; exit 1; }
  printf '%s' "${line#*=}"
}

DB_HOST="$(read_env DB_HOST)"
DB_PORT="$(read_env DB_PORT)"
DB_NAME="$(read_env DB_NAME)"
DB_SCHEMA="$(read_env DB_SCHEMA)"
DB_USER="$(read_env DB_USER)"
APP_PASS="$(read_env DB_PASS)"
MIG_USER="$(read_env DB_MIGRATOR_USER)"
MIG_PASS="$(read_env DB_MIGRATOR_PASS)"

if [[ -z "$APP_PASS" || -z "$MIG_PASS" ]]; then
  echo "error: DB_PASS and DB_MIGRATOR_PASS must both be non-empty" >&2
  exit 1
fi

if [[ "$DB_USER" == "$MIG_USER" ]]; then
  # This is the single-role configuration: the app role would own every table,
  # and PostgreSQL exempts an owner from its own RLS policies, so tenant
  # isolation would be silently inert. Production refuses to start like this.
  echo "error: DB_USER and DB_MIGRATOR_USER are both '$DB_USER'." >&2
  echo "       Use two distinct roles — the app role must not own the tables." >&2
  exit 1
fi

echo "Bootstrapping ${DB_NAME} on ${DB_HOST}:${DB_PORT}"
echo "  schema     : ${DB_SCHEMA}"
echo "  app role   : ${DB_USER}"
echo "  owner role : ${MIG_USER}"

# CREATE ROLE ... PASSWORD cannot be parameterised. These come from .env rather
# than user input, but refuse anything that could terminate the statement early
# and let a password be read as SQL.
for pw in "$APP_PASS" "$MIG_PASS"; do
  if [[ "$pw" == *"'"* ]]; then
    echo "error: a password contains a single quote; rotate it to an alphanumeric value" >&2
    exit 1
  fi
done

if ! sudo -n true 2>/dev/null; then
  echo "note: sudo will ask for your password (required to reach the postgres superuser)." >&2
fi

# Roles and the database are cluster-level, so they are created against the
# maintenance database.
sudo -u postgres psql --set ON_ERROR_STOP=1 --quiet \
  --set db_name="$DB_NAME" \
  --set app_user="$DB_USER" \
  --set mig_user="$MIG_USER" \
  --set app_pass="$APP_PASS" \
  --set mig_pass="$MIG_PASS" \
  --set schema="$DB_SCHEMA" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'app_user', :'app_pass')
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user')
\gexec

SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'mig_user', :'mig_pass')
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'mig_user')
\gexec

-- Owned by the migrator role: that is what makes FORCE ROW LEVEL SECURITY
-- meaningful, because the app role then owns nothing and RLS always applies.
SELECT format('CREATE DATABASE %I OWNER %I', :'db_name', :'mig_user')
  WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db_name')
\gexec
SQL

# The schema and the extension are per-database, so they have to be created with
# the target database open. The extension goes INTO the schema (a bare
# CREATE EXTENSION lands it in `public`, where the qualified
# <schema>.vector type reference would not resolve).
sudo -u postgres psql --set ON_ERROR_STOP=1 --quiet \
  --dbname="$DB_NAME" \
  --set schema="$DB_SCHEMA" \
  --set mig_user="$MIG_USER" \
  --set app_user="$DB_USER" <<'SQL'
SELECT format('CREATE SCHEMA IF NOT EXISTS %I AUTHORIZATION %I', :'schema', :'mig_user')
\gexec

SELECT format('CREATE EXTENSION IF NOT EXISTS vector SCHEMA %I', :'schema')
\gexec

-- USAGE only. The app role must NOT have CREATE on the schema; it gets DML on
-- the tables from grantAppPrivileges() after the migration runs.
SELECT format('GRANT USAGE ON SCHEMA %I TO %I', :'schema', :'app_user')
\gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'app_user')
\gexec
SQL

echo
echo "Done. Next:"
echo "  1. npm run migrate"
echo "  2. npm run build && npm start"
echo "  3. open http://localhost:3000/register and create the first account"