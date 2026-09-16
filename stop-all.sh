#!/usr/bin/env bash
# Stop control plane (4097), executor, and frontend.
#
# Architecture note (2026-09-02+): on the test server, :3000 is a STATIC NGINX
# site serving /data/app/front-dist/current — nginx is NOT stopped by default.
# The executor normally runs on a Windows PC, not on the server; stopping it
# here is harmless (no-op) but kept for local/all-in-one setups.
#
# Usage:
#   ./stop-all.sh                  # stop control plane + executor (nginx untouched)
#   SKIP_EXECUTOR=1 ./stop-all.sh  # stop control plane only
#   STOP_FRONTEND=1 ./stop-all.sh  # ALSO kill :3000 — use only where vite dev
#                                  # actually owns 3000 (local dev), NEVER on the
#                                  # test server (it would kill nginx)
#   STOP_XVFB=1 ./stop-all.sh      # also stop Xvfb

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JS_GEN_DIR="${JS_GEN_DIR:-$SCRIPT_DIR}"
FRONTEND_DIR="${FRONTEND_DIR:-/data/app/ui-auto-recording-agent-vue-master/vue-project}"
DISPLAY_NUM="${DISPLAY_NUM:-99}"
CONTROL_PORT="${CONTROL_PORT:-4097}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"

log() { printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }

resolve_frontend_dir() {
  if [[ -f "$FRONTEND_DIR/package.json" ]]; then
    return 0
  fi
  if [[ -f "$FRONTEND_DIR/vue-project/package.json" ]]; then
    FRONTEND_DIR="${FRONTEND_DIR}/vue-project"
  fi
}

kill_port() {
  local port="$1"
  local pids
  if command -v lsof >/dev/null 2>&1; then
    pids="$(lsof -t -i ":${port}" 2>/dev/null || true)"
  else
    pids="$(ss -ltnp 2>/dev/null | grep ":${port} " | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u || true)"
  fi
  if [[ -n "$pids" ]]; then
    log "Stopping port ${port}: ${pids}"
    kill -9 $pids 2>/dev/null || true
  fi
}

kill_pattern() {
  local pattern="$1"
  if pgrep -f "$pattern" >/dev/null 2>&1; then
    log "Stopping: ${pattern}"
    pkill -f "$pattern" 2>/dev/null || true
  fi
}

resolve_frontend_dir

kill_port "$CONTROL_PORT"

if [[ "${SKIP_EXECUTOR:-0}" != "1" ]]; then
  kill_pattern "node executor/agent.mjs"
else
  log "SKIP_EXECUTOR=1 — executor untouched"
fi

if [[ "${STOP_FRONTEND:-0}" == "1" ]]; then
  log "STOP_FRONTEND=1 — killing :${FRONTEND_PORT} (only safe where vite dev owns 3000, NOT the test server)"
  kill_port "$FRONTEND_PORT"
  kill_pattern "vite --host"
else
  log "Frontend :${FRONTEND_PORT} untouched (nginx static site on the test server; use STOP_FRONTEND=1 to override)"
fi

if [[ "${STOP_XVFB:-0}" == "1" ]]; then
  kill_pattern "Xvfb :${DISPLAY_NUM}"
fi

log "Stopped."
log "  control :${CONTROL_PORT}  executor:$( [[ "${SKIP_EXECUTOR:-0}" == "1" ]] && echo skipped || echo stopped )  frontend:$( [[ "${STOP_FRONTEND:-0}" == "1" ]] && echo killed || echo untouched )"
log "  FRONTEND_DIR=${FRONTEND_DIR}"
