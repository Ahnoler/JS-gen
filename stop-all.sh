#!/usr/bin/env bash
# Stop control plane, executor, frontend, and optionally Xvfb.
#
# Usage:
#   ./stop-all.sh
#   STOP_XVFB=1 ./stop-all.sh

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
  pids="$(lsof -t -i ":${port}" 2>/dev/null || true)"
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
kill_port "$FRONTEND_PORT"
kill_pattern "node executor/agent.mjs"
kill_pattern "vite --host"

if [[ "${STOP_XVFB:-0}" == "1" ]]; then
  kill_pattern "Xvfb :${DISPLAY_NUM}"
fi

log "Stopped."
log "  control :${CONTROL_PORT}  frontend :${FRONTEND_PORT}  executor  Xvfb(:${STOP_XVFB:-0})"
log "  FRONTEND_DIR=${FRONTEND_DIR}"
