#!/usr/bin/env bash
# Restore a backup made by db-backup.sh into the configured MongoDB database.
#
# Usage:
#   npm run db:restore                          # restores the newest backups/*.archive.gz, merge mode
#   npm run db:restore -- backups/dotmarket-....archive.gz
#   npm run db:restore -- --drop                # DESTRUCTIVE: replace existing collections instead of merging
#
# Merge mode (the default) upserts documents by _id and leaves anything else
# in the target database alone — safe to run against a database that already
# has data. --drop replaces each collection wholesale (anything not in the
# archive is lost) and requires typing the target host to confirm.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

if [ -z "${MONGODB_URI:-}" ]; then
  echo "MONGODB_URI is not set (checked the environment and .env)." >&2
  exit 1
fi
if ! command -v mongorestore >/dev/null 2>&1; then
  echo "mongorestore not found. Install the MongoDB Database Tools:" >&2
  echo "  https://www.mongodb.com/try/download/database-tools" >&2
  exit 1
fi

DROP=false
FILE=""
for arg in "$@"; do
  case "$arg" in
    --drop) DROP=true ;;
    *) FILE="$arg" ;;
  esac
done

if [ -z "$FILE" ]; then
  FILE="$(find backups -maxdepth 1 -name 'dotmarket-*.archive.gz' 2>/dev/null | sort | tail -n 1)"
  if [ -z "$FILE" ]; then
    echo "No backup file given and none found under backups/. Pass one explicitly." >&2
    exit 1
  fi
fi
if [ ! -f "$FILE" ]; then
  echo "Backup file not found: $FILE" >&2
  exit 1
fi

SAFE_HOST="$(echo "$MONGODB_URI" | sed -E 's#//[^@]*@#//***:***@#')"
echo "Target:  $SAFE_HOST"
echo "Archive: $FILE"
echo "Mode:    $([ "$DROP" = true ] && echo 'DROP (replaces existing collections)' || echo 'merge (upserts by _id, leaves other data alone)')"
echo
read -r -p "Type the database host shown above to confirm: " CONFIRM_HOST
if [ "$CONFIRM_HOST" != "$SAFE_HOST" ]; then
  echo "Confirmation did not match — aborted." >&2
  exit 1
fi

if [ "$DROP" = true ]; then
  mongorestore --uri="$MONGODB_URI" --gzip --archive="$FILE" --drop
else
  mongorestore --uri="$MONGODB_URI" --gzip --archive="$FILE"
fi
echo "Restore complete."
