#!/usr/bin/env bash
# Start (or reuse) the local dev Mongo container as a single-node replica set.
#
# A plain standalone `mongod` can't run multi-document transactions — only a
# replica set can (Atlas, used in production, always is one). Running the
# local container with --replSet and initiating it once makes the same
# transaction-wrapped code paths (lib/seller-store.js's runTxn) actually take
# the transactional route locally too, instead of silently falling back.
#
# Idempotent: safe to run again on an already-initiated replica set or an
# already-running container.
set -euo pipefail

NAME=dot-marketplace-mongo

docker start "$NAME" 2>/dev/null || docker run -d \
  --name "$NAME" \
  -p 27017:27017 \
  -v dot_marketplace_mongo:/data/db \
  --restart unless-stopped \
  mongo:7 --replSet rs0 --bind_ip_all

echo "Waiting for mongod..."
for _ in $(seq 1 30); do
  if docker exec "$NAME" mongosh --quiet --eval 'db.runCommand({ ping: 1 })' >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

docker exec "$NAME" mongosh --quiet --eval '
  try {
    rs.status();
  } catch (e) {
    rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "127.0.0.1:27017" }] });
    print("Replica set initiated.");
  }
' >/dev/null

echo "Mongo ready at mongodb://127.0.0.1:27017/dotmarket?replicaSet=rs0 (container: $NAME)"
