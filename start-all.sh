#!/usr/bin/env bash
# Start control plane (4097), executor agent, and frontend dev server (3000).
#
# Usage:
#   ./start-all.sh
#   SKIP_EXECUTOR=1 ./start-all.sh      # backend + frontend only
#   SKIP_FRONTEND=1 ./start-all.sh      # backend + executor only
#
# Env overrides:
#   JS_GEN_DIR=/data/app/JS-gen
#   FRONTEND_DIR=/data/app/ui-auto-recording-agent-vue-master/vue-project
#   CHROME_HEADLESS=true          # skip Xvfb; Session Chrome --headless=new
#   DISPLAY_NUM=99
#   XVFB_RESOLUTION=1920x1080x24

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JS_GEN_DIR="${JS_GEN_DIR:-$SCRIPT_DIR}"
FRONTEND_DIR="${FRONTEND_DIR:-/data/app/ui-auto-recording-agent-vue-master/vue-project}"
DISPLAY_NUM="${DISPLAY_NUM:-99}"
XVFB_RESOLUTION="${XVFB_RESOLUTION:-1920x1080x24}"
CONTROL_PORT="${CONTROL_PORT:-4097}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"

log() { printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
die() { log "ERROR: $*"; exit 1; }

# Prefer process env, then executor/.env, then config/.env
read_env_file_val() {
  local key="$1" file="$2"
  [[ -f "$file" ]] || return 0
  local line
  line="$(grep -E "^[[:space:]]*${key}=" "$file" 2>/dev/null | tail -1 || true)"
  [[ -n "$line" ]] || return 0
  printf '%s' "${line#*=}" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^["'\'']//' -e 's/["'\'']$//'
}

chrome_headless_enabled() {
  local raw="${CHROME_HEADLESS:-}"
  if [[ -z "$raw" ]]; then
    raw="$(read_env_file_val CHROME_HEADLESS "${JS_GEN_DIR}/executor/.env")"
  fi
  if [[ -z "$raw" ]]; then
    raw="$(read_env_file_val CHROME_HEADLESS "${JS_GEN_DIR}/config/.env")"
  fi
  raw="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]')"
  [[ "$raw" == "1" || "$raw" == "true" || "$raw" == "yes" || "$raw" == "on" ]]
}

kill_port() {
  local port="$1"
  local pids
  pids="$(lsof -t -i ":${port}" 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    log "Stopping process(es) on port ${port}: ${pids}"
    kill -9 $pids 2>/dev/null || true
    sleep 1
  fi
}

kill_pattern() {
  local pattern="$1"
  if pgrep -f "$pattern" >/dev/null 2>&1; then
    log "Stopping process(es) matching: ${pattern}"
    pkill -f "$pattern" 2>/dev/null || true
    sleep 1
  fi
}

resolve_frontend_dir() {
  if [[ -f "$FRONTEND_DIR/package.json" ]]; then
    return 0
  fi
  if [[ -f "$FRONTEND_DIR/vue-project/package.json" ]]; then
    log "FRONTEND_DIR has no package.json — using ${FRONTEND_DIR}/vue-project"
    FRONTEND_DIR="${FRONTEND_DIR}/vue-project"
    return 0
  fi
  die "Frontend package.json not found under ${FRONTEND_DIR} (expected vue-project subdir)"
}

ensure_xvfb() {
  export DISPLAY=":${DISPLAY_NUM}"
  if pgrep -f "Xvfb :${DISPLAY_NUM}" >/dev/null 2>&1; then
    log "Xvfb already running on DISPLAY=${DISPLAY}"
    return 0
  fi
  if ! command -v Xvfb >/dev/null 2>&1; then
    die "Xvfb not found. Install: yum install -y xorg-x11-server-Xvfb"
  fi
  log "Starting Xvfb on DISPLAY=${DISPLAY} (${XVFB_RESOLUTION})"
  Xvfb ":${DISPLAY_NUM}" -screen 0 "${XVFB_RESOLUTION}" >/dev/null 2>&1 &
  sleep 1
  pgrep -f "Xvfb :${DISPLAY_NUM}" >/dev/null 2>&1 || die "Failed to start Xvfb"
}

start_backend() {
  [[ -d "$JS_GEN_DIR" ]] || die "JS-gen dir not found: $JS_GEN_DIR"
  cd "$JS_GEN_DIR" || die "Cannot cd to $JS_GEN_DIR"
  mkdir -p logs
  kill_port "$CONTROL_PORT"
  log "Starting control plane on :${CONTROL_PORT}"
  nohup npm start > logs/server.log 2>&1 &
  sleep 2
  if lsof -i ":${CONTROL_PORT}" >/dev/null 2>&1; then
    log "Control plane is up (:${CONTROL_PORT})"
    tail -5 logs/server.log || true
  else
    log "Control plane may have failed — check logs/server.log"
    tail -20 logs/server.log || true
    exit 1
  fi
}

start_executor() {
  [[ -d "$JS_GEN_DIR" ]] || die "JS-gen dir not found: $JS_GEN_DIR"
  cd "$JS_GEN_DIR" || die "Cannot cd to $JS_GEN_DIR"
  mkdir -p logs

  if [[ ! -f executor/.env ]] && [[ -z "${EXECUTOR_TOKEN:-}" ]]; then
    log "WARN: executor/.env missing — copy executor/.env.example and set EXECUTOR_TOKEN"
  fi

  kill_pattern "node executor/agent.mjs"
  if chrome_headless_enabled(); then
    log "CHROME_HEADLESS on — starting executor without Xvfb (Session Chrome --headless=new)"
    # Ensure Python child sees the flag even if only set in this shell
    nohup env CHROME_HEADLESS=true npm run executor > logs/executor.log 2>&1 &
  else
    ensure_xvfb
    log "Starting executor agent (DISPLAY=${DISPLAY})"
    nohup env DISPLAY="${DISPLAY}" npm run executor > logs/executor.log 2>&1 &
  fi
  sleep 2
  if pgrep -f "node executor/agent.mjs" >/dev/null 2>&1; then
    log "Executor process is up"
    tail -5 logs/executor.log || true
  else
    log "Executor may have failed — check logs/executor.log"
    tail -20 logs/executor.log || true
    exit 1
  fi
}

start_frontend() {
  resolve_frontend_dir
  [[ -d "$FRONTEND_DIR" ]] || die "Frontend dir not found: $FRONTEND_DIR"
  cd "$FRONTEND_DIR" || die "Cannot cd to $FRONTEND_DIR"
  mkdir -p logs
  kill_port "$FRONTEND_PORT"
  kill_pattern "vite --host"
  log "Starting frontend dev server on :${FRONTEND_PORT} (vite --host)"
  nohup npm run dev > logs/dev.log 2>&1 &
  sleep 3
  if lsof -i ":${FRONTEND_PORT}" >/dev/null 2>&1; then
    log "Frontend is up (:${FRONTEND_PORT})"
    tail -8 logs/dev.log || true
  else
    log "Frontend may have failed — check logs/dev.log"
    tail -30 logs/dev.log || true
    exit 1
  fi
}

print_status() {
  log "---- status ----"
  lsof -i ":${CONTROL_PORT}" 2>/dev/null || log "control plane: not listening"
  lsof -i ":${FRONTEND_PORT}" 2>/dev/null || log "frontend: not listening"
  pgrep -af "node executor/agent.mjs" 2>/dev/null || log "executor: not running"
  if chrome_headless_enabled(); then
    log "CHROME_HEADLESS=true (Xvfb not required)"
  else
    pgrep -af "Xvfb :${DISPLAY_NUM}" 2>/dev/null || true
  fi
  log "logs:"
  log "  tail -f ${JS_GEN_DIR}/logs/server.log"
  log "  tail -f ${JS_GEN_DIR}/logs/executor.log"
  log "  tail -f ${FRONTEND_DIR}/logs/dev.log"
}

main() {
  resolve_frontend_dir
  log "JS_GEN_DIR=${JS_GEN_DIR}"
  log "FRONTEND_DIR=${FRONTEND_DIR}"

  start_backend

  if [[ "${SKIP_EXECUTOR:-0}" != "1" ]]; then
    start_executor
  else
    log "SKIP_EXECUTOR=1 — executor not started"
  fi

  if [[ "${SKIP_FRONTEND:-0}" != "1" ]]; then
    start_frontend
  else
    log "SKIP_FRONTEND=1 — frontend not started"
  fi

  print_status
  log "Done. SSH disconnect will not stop these processes."
}

main "$@"
