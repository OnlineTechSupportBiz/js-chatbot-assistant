# Runs once on first init (as the postgres superuser) against POSTGRES_DB.
#
# Creates the two roles the RLS model needs, plus the schema and the pgvector
# extension the migration depends on. The bare-metal equivalent of this is
# INSTALL.md step 1 — keep the two in step.
#
# The role passwords are required: this script used to fall back to
# 'migrator_pass' / 'chatbot_pass', so a default deployment shipped with guessable
# credentials for the table owner (which can also disable RLS).
set -e

if [ -z "$MIGRATOR_DB_PASSWORD" ] || [ -z "$APP_DB_PASSWORD" ]; then
  echo "Refusing to initialise: MIGRATOR_DB_PASSWORD and APP_DB_PASSWORD must both be set." >&2
  echo "Generate them (e.g. openssl rand -hex 24) and pass them via the environment." >&2
  exit 1
fi

# Must match DB_SCHEMA / DB_USER / DB_MIGRATOR_USER in docker-compose.yml.
SCHEMA="${DB_SCHEMA:-chatbot_schema}"
APP_ROLE="${DB_USER:-chatbot_user}"
MIGRATOR_ROLE="${DB_MIGRATOR_USER:-chatbot_migrator}"

echo "Initialising schema '${SCHEMA}' with roles '${MIGRATOR_ROLE}' (owner) and '${APP_ROLE}' (app)"

# The schema has to exist before the extension can be installed INTO it. The
# migration types document_chunks.embedding as <schema>.vector, so a bare
# `CREATE EXTENSION vector` (which lands in `public`) would not resolve.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE SCHEMA IF NOT EXISTS "${SCHEMA}" AUTHORIZATION "${MIGRATOR_ROLE}";

  CREATE EXTENSION IF NOT EXISTS vector SCHEMA "${SCHEMA}";

  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${MIGRATOR_ROLE}') THEN
      CREATE ROLE "${MIGRATOR_ROLE}" LOGIN PASSWORD '${MIGRATOR_DB_PASSWORD}';
    END IF;
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${APP_ROLE}') THEN
      CREATE ROLE "${APP_ROLE}" LOGIN PASSWORD '${APP_DB_PASSWORD}';
    END IF;
  END
  \$\$;

  -- USAGE only: the app role must NOT have CREATE on the schema. It receives
  -- DML on the tables from grantAppPrivileges() after the migration runs.
  GRANT USAGE ON SCHEMA "${SCHEMA}" TO "${APP_ROLE}";
  GRANT CONNECT ON DATABASE "${POSTGRES_DB}" TO "${APP_ROLE}";
EOSQL