#!/usr/bin/env bash
# Clean demo state: restarts both in-memory FHIR servers (no Docker), loads the real OAH data into the city server
# and the OAH population health measures into the health server.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
bash "$ROOT/scripts/run-servers.sh" stop || true
sleep 2
bash "$ROOT/scripts/run-servers.sh" start
node "$ROOT/scripts/seed.mjs"
node "$ROOT/scripts/seed.mjs" --health
