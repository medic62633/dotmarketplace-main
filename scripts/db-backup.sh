#!/usr/bin/env bash
# Dump the configured MongoDB database to a timestamped, gzip-compressed
# archive under backups/ (already gitignored — never commit these; they
# contain the same money/PII data the .env leak incident exposed).
#
# Usage:
#   npm run db:backup                # backs up MONGODB_URI from .env
#   KEEP=30 npm run db:backup        # keep the last 30 backups instead of 14
#
# Requires the MongoDB Database Tools (mongodump) — install from
# https://www.mongodb.com/try/download/database-tools, or on a VPS:
#   sudo apt-get install -y mongodb-database-tools
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

if [ -z "${MONGODB_URI:-}" ]; then
  echo "MONGODB_URI is not set (checked the environment and .env) — nothing to back up." >&2
  exit 1
fi
if ! command -v mongodump >/dev/null 2>&1; then
  echo "mongodump not found. Install the MongoDB Database Tools:" >&2
  echo "  https://www.mongodb.com/try/download/database-tools" >&2
  exit 1
fi

KEEP="${KEEP:-14}"
mkdir -p backups
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="backups/dotmarket-$STAMP.archive.gz"

# Print only the host, never the credentials in the URI.
SAFE_HOST="$(echo "$MONGODB_URI" | sed -E 's#//[^@]*@#//***:***@#')"
echo "Backing up $SAFE_HOST -> $OUT"

mongodump --uri="$MONGODB_URI" --gzip --archive="$OUT"
echo "Wrote $OUT ($(du -h "$OUT" | cut -f1))"

# Prune to the last $KEEP backups so a VPS's local disk doesn't fill up
# unboundedly (same constraint the README already calls out for uploads/).
COUNT=$(find backups -maxdepth 1 -name 'dotmarket-*.archive.gz' | wc -l | tr -d ' ')
if [ "$COUNT" -gt "$KEEP" ]; then
  find backups -maxdepth 1 -name 'dotmarket-*.archive.gz' | sort | head -n "$((COUNT - KEEP))" | xargs rm -f
  echo "Pruned to the last $KEEP backups."
fi
