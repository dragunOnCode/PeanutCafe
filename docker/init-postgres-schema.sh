#!/usr/bin/env bash
# Apply init-postgres-schema.sql to the Postgres container from docker-compose.yml.
# Usage (on the server, from repo or copy both files into the same directory):
#   chmod +x init-postgres-schema.sh
#   ./init-postgres-schema.sh
#
# Override defaults if your compose file differs:
#   PG_CONTAINER=my-postgres PG_USER=admin PG_DB=lobster ./init-postgres-schema.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL_FILE="${SCRIPT_DIR}/init-postgres-schema.sql"

PG_CONTAINER="${PG_CONTAINER:-lobster-postgres}"
PG_USER="${PG_USER:-admin}"
PG_DB="${PG_DB:-lobster}"

if [[ ! -f "${SQL_FILE}" ]]; then
  echo "Missing ${SQL_FILE}" >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running or not accessible." >&2
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -qx "${PG_CONTAINER}"; then
  echo "Container '${PG_CONTAINER}' is not running. Start stack first: docker compose up -d" >&2
  exit 1
fi

echo "Applying schema to ${PG_CONTAINER} (user=${PG_USER}, db=${PG_DB})..."
docker exec -i "${PG_CONTAINER}" psql -v ON_ERROR_STOP=1 -U "${PG_USER}" -d "${PG_DB}" < "${SQL_FILE}"
echo "Done."
