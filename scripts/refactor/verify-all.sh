#!/usr/bin/env bash
# Refactoring gate: run the core characterization/smoke suite.
# Every refactoring micro-step ends with this script; any failure stops the batch.
#   bash scripts/refactor/verify-all.sh
set -u

# Resolve a Python interpreter that works from Git Bash, WSL, or cmd.
if command -v python >/dev/null 2>&1; then
  PY=python
elif command -v python.exe >/dev/null 2>&1; then
  PY=python.exe
elif command -v python3 >/dev/null 2>&1; then
  PY=python3
else
  echo "verify-all: no python interpreter found" >&2
  exit 1
fi

cd "$(dirname "$0")/../.."
FAILED=0

run() {
  local desc="$1"; shift
  echo "=== $desc ==="
  if ! "$@" > /tmp/verify-all.out 2>&1; then
    echo "!! FAILED: $desc"
    tail -20 /tmp/verify-all.out
    FAILED=1
  else
    tail -1 /tmp/verify-all.out
    echo "ok: $desc"
  fi
}

run "characterize-dedup"       node scripts/characterization/characterize-dedup.mjs
run "characterize-ctrl"        node scripts/characterization/characterize-ctrl.mjs
run "characterize-trajectory"  node scripts/characterization/characterize-trajectory.mjs
run "characterize-region-tree" node scripts/characterization/characterize-region-tree.mjs
run "characterize-transaction-export-region" node scripts/characterization/characterize-transaction-export-region.mjs
run "characterize-assembler" "$PY" scripts/characterization/characterize-assembler-click.py
run "characterize-form-rules" "$PY" scripts/characterization/characterize-form-rules.py
run "accept-replay-apis"       node scripts/smoke/accept-replay-apis.mjs
run "characterize-scan-editable-summary" "$PY" scripts/characterization/characterize-scan-editable-summary.py
run "characterize-scan-fullpage-p1" "$PY" scripts/characterization/characterize-scan-fullpage-p1.py
run "characterize-phase-section-scope" "$PY" scripts/characterization/characterize-phase-section-scope.py
run "characterize-capture-element-xpath" "$PY" scripts/characterization/characterize-capture-element-xpath.py
run "characterize-xpath-primary-ops" "$PY" scripts/characterization/characterize-xpath-primary-ops.py
run "characterize-xpath-fill-select" "$PY" scripts/characterization/characterize-xpath-fill-select.py
run "characterize-region-section-alias" "$PY" scripts/characterization/characterize-region-section-alias.py
run "characterize-phase-runtime" "$PY" scripts/characterization/characterize-phase-runtime.py
run "characterize-select-option-substring" "$PY" scripts/characterization/characterize-select-option-substring.py
run "characterize-close-dialog-replay" "$PY" scripts/characterization/characterize-close-dialog-replay.py
run "characterize-cascade-three-round" "$PY" scripts/characterization/characterize-cascade-three-round.py
run "characterize-dialog-tasklist-scope" "$PY" scripts/characterization/characterize-dialog-tasklist-scope.py
run "characterize-container-naming" "$PY" scripts/characterization/characterize-container-naming.py
run "characterize-field-value-match" "$PY" scripts/characterization/characterize-field-value-match.py
run "characterize-dual-save-section" "$PY" scripts/characterization/characterize-dual-save-section.py
run "characterize-form-assistant" "$PY" scripts/characterization/characterize-form-assistant.py
run "characterize-introduce-query-fill" "$PY" scripts/characterization/characterize-introduce-query-fill.py
run "characterize-select-state-boundary" "$PY" scripts/characterization/characterize-select-state-boundary.py
run "characterize-date-fill-merge" "$PY" scripts/characterization/characterize-date-fill-merge.py
run "characterize-replay-params-xpath" "$PY" scripts/characterization/characterize-replay-params-xpath.py
run "characterize-tree-select-record" "$PY" scripts/characterization/characterize-tree-select-record.py
run "characterize-inventory-memory" "$PY" scripts/characterization/characterize-inventory-memory.py
run "characterize-control-ops-closed-loop" "$PY" scripts/characterization/characterize-control-ops-closed-loop.py
run "characterize-case-data" "$PY" scripts/characterization/characterize-case-data.py
run "characterize-login-action" "$PY" scripts/characterization/characterize-login-action.py
run "characterize-assistant-mission-context" "$PY" scripts/characterization/characterize-assistant-mission-context.py
run "characterize-scan-fullpage-p2" "$PY" scripts/characterization/characterize-scan-fullpage-p2.py
run "characterize-form-snapshot-trigger" node scripts/characterization/characterize-form-snapshot-trigger.mjs
run "characterize-sys-msg" node scripts/characterization/characterize-sys-msg.mjs
run "characterize-batch-import" node scripts/characterization/characterize-batch-import.mjs
run "characterize-step-move" node scripts/characterization/characterize-step-move.mjs

if [ "$FAILED" -ne 0 ]; then
  echo "========================================"
  echo "verify-all: FAILED — revert the micro-step"
  exit 1
fi
echo "verify-all: ALL GREEN"
