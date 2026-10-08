#!/usr/bin/env bash
# Local dev Postgres for js-chatbot-assistant (matches .env: 127.0.0.1:54329).
#
#   scripts/dev-db.sh start|stop|status
#
# The cluster is Pg16 with pgvector. It runs as the current user on a private
# Unix socket dir, so no root and no system service is involved.
#
# Override the data dir with PGDATA if you relocate the cluster:
#   PGDATA=/home/ray/.local/share/js-chatbot-assistant/pgdata scripts/dev-db.sh start
set -euo pipefail

PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
PGDATA="${PGDATA:-/home/ray/.hermes/cache/scratch/pgtest/data}"
PGPORT="${PGPORT:-54329}"
PGSOCK="${PGSOCK:-$(dirname "$PGDATA")/sock}"
PGLOG="${PGLOG:-$(dirname "$PGDATA")/postgres.log}"

if [ ! -f "$PGDATA/PG_VERSION" ]; then
  echo "No cluster at $PGDATA" >&2
  exit 1
fi

case "${1:-status}" in
  start)
    mkdir -p "$PGSOCK"
    if "$PG_BIN/pg_isready" -h 127.0.0.1 -p "$PGPORT" >/dev/null 2>&1; then
      echo "already running on $PGPORT"
      exit 0
    fi
    "$PG_BIN/pg_ctl" -D "$PGDATA" -l "$PGLOG" \
      -o "-p $PGPORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$PGSOCK" \
      -w start
    ;;
  stop)
    "$PG_BIN/pg_ctl" -D "$PGDATA" -m fast -w stop
    ;;
  status)
    "$PG_BIN/pg_isready" -h 127.0.0.1 -p "$PGPORT" || true
    ;;
  *)
    echo "usage: $0 {start|stop|status}" >&2
    exit 2
    ;;
esac
