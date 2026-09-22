#!/usr/bin/env bash
# Runs the two HAPI FHIR servers without Docker (java -jar), for machines where Docker is unavailable.
# Same configuration as docker-compose.yml. Requires tools/hapi-src/target/ROOT.war (see README).
#   city   -> http://localhost:8081/fhir     health -> http://localhost:8082/fhir
# Usage: scripts/run-servers.sh start|stop|status
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
JAVA="${JAVA:-$(ls -d "$ROOT"/tools/jdk-17*/bin/java)}"  # override with JAVA=java
WAR="$ROOT/tools/hapi-src/target/ROOT.war"
RUN="$ROOT/build/servers"

# Java on Windows needs native paths (D:/...), not Git Bash paths (/d/...).
native() { if command -v cygpath > /dev/null; then cygpath -m "$1"; else echo "$1"; fi; }

start_one() { # name port
  local name=$1 port=$2 dir="$RUN/$1"
  mkdir -p "$dir/tmp"
  local ndir packages
  ndir="$(native "$dir")"
  packages="$(native "$ROOT/fhir-packages" | sed 's/ /%20/g')"
  # Same overrides as Docker, with package paths pointing at this checkout instead of /packages.
  sed "s#file:///packages/#file:///$packages/#" "$ROOT/servers/hapi-overrides.yaml" > "$dir/overrides.yaml"
  (cd "$dir" && nohup "$JAVA" -Xmx2g -Djava.io.tmpdir="$ndir/tmp" -jar "$(native "$WAR")" \
    --server.port="$port" \
    --spring.config.additional-location="file:$ndir/overrides.yaml" \
    --hibernate.search.backend.directory.root="$ndir/lucene" \
    > "$dir/server.log" 2>&1 & echo $! > "$dir/pid")
  echo "started $name on :$port (log: $dir/server.log)"
}

wait_ready() { # port
  for _ in $(seq 1 90); do
    curl -sf -o /dev/null "http://localhost:$1/fhir/metadata" && { echo "ready on :$1"; return 0; }
    sleep 5
  done
  echo "server on :$1 did not become ready; see $RUN/*/server.log" >&2; return 1
}

case "${1:-start}" in
  start) start_one city 8081; start_one health 8082; wait_ready 8081; wait_ready 8082 ;;
  stop)
    # Match the actual java processes (PID files from nohup under Git Bash are not the Windows PIDs).
    if command -v powershell > /dev/null; then
      powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='java.exe'\" | Where-Object { \$_.CommandLine -like '*hapi-src*ROOT.war*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force; 'stopped pid ' + \$_.ProcessId }"
    else
      pkill -f 'hapi-src/target/ROOT.war' && echo "stopped servers" || true
    fi
    rm -f "$RUN"/*/pid ;;
  status) for p in 8081 8082; do curl -sf -o /dev/null "http://localhost:$p/fhir/metadata" && echo ":$p up" || echo ":$p down"; done ;;
esac
