#!/usr/bin/env bash
# Upload project from your laptop to the VPS (run locally, not on VPS)
#
# Usage:
#   chmod +x scripts/upload-to-vps.sh
#   ./scripts/upload-to-vps.sh root@212.193.3.162
#
# Requires: rsync + ssh access to the VPS

set -euo pipefail

TARGET="${1:-root@212.193.3.162}"
REMOTE_DIR="/opt/dot-marketplace"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "Uploading $ROOT -> $TARGET:$REMOTE_DIR"

ssh "$TARGET" "mkdir -p $REMOTE_DIR"

rsync -avz --delete \
  --exclude node_modules \
  --exclude .git \
  --exclude test \
  --exclude docker-compose.yml \
  --exclude backups \
  --exclude '.smoke.log' \
  "$ROOT/" "$TARGET:$REMOTE_DIR/"

echo ""
echo "Done. SSH in and deploy:"
echo "  ssh $TARGET"
echo "  cd $REMOTE_DIR && chmod +x scripts/deploy-vps.sh && sudo ./scripts/deploy-vps.sh"
