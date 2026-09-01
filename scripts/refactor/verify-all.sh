#!/usr/bin/env bash
# Refactoring gate: run the core characterization/smoke suite.
# Every refactoring micro-step ends with this script; any failure stops the batch.
#   bash scripts/refactor/verify-all.sh
set -u

# Resolve a Python interpreter that works from Git Bash, WSL, or cmd.
# Order mirrors config/config.js _findPython: explicit PYTHON_EXE → project-embedded
# python (portable install; has browser_use etc.) → system PATH.
PY=""
resolve_python() {
  if [ -n "${PYTHON_EXE:-}" ]; then
    if command -v "$PYTHON_EXE" >/dev/null 2>&1; then PY="$PYTHON_EXE"; return 0; fi
    if [ -x "$PYTHON_EXE" ]; then PY="$PYTHON_EXE"; return 0; fi
  fi
  if [ -x "./python/python.exe" ]; then PY="./python/python.exe"; return 0; fi
  if [ -x "./python/python" ]; then PY="./python/python"; return 0; fi
  if command -v python >/dev/null 2>&1; then PY=python; return 0; fi
  if command -v python.exe >/dev/null 2>&1; then PY=python.exe; return 0; fi
  if command -v python3 >/dev/null 2>&1; then PY=python3; return 0; fi
  echo "verify-all: no python interpreter found" >&2
  return 1
}

cd "$(dirname "$0")/../.."
resolve_python || exit 1
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
run "characterize-trajectory"  node scripts/characterization/characterize-trajectory.mjs
run "characterize-region-tree" node scripts/characterization/characterize-region-tree.mjs
run "characterize-transaction-export-region" node scripts/characterization/characterize-transaction-export-region.mjs
run "characterize-form-rules" "$PY" scripts/characterization/characterize-form-rules.py
run "characterize-scan-editable-summary" "$PY" scripts/characterization/characterize-scan-editable-summary.py
run "characterize-scan-fullpage-p1" "$PY" scripts/characterization/characterize-scan-fullpage-p1.py
run "characterize-phase-section-scope" "$PY" scripts/characterization/characterize-phase-section-scope.py
run "characterize-capture-element-xpath" "$PY" scripts/characterization/characterize-capture-element-xpath.py
run "characterize-xpath-primary-ops" "$PY" scripts/characterization/characterize-xpath-primary-ops.py
run "characterize-xpath-fill-select" "$PY" scripts/characterization/characterize-xpath-fill-select.py
run "characterize-region-section-alias" "$PY" scripts/characterization/characterize-region-section-alias.py
run "characterize-phase-runtime" "$PY" scripts/characterization/characterize-phase-runtime.py
run "characterize-phase-save-cue-promote" "$PY" scripts/characterization/characterize-phase-save-cue-promote.py
run "characterize-select-option-substring" "$PY" scripts/characterization/characterize-select-option-substring.py
run "characterize-select-option-stamp" "$PY" scripts/characterization/characterize-select-option-stamp.py
run "characterize-select-option-verify" "$PY" scripts/characterization/characterize-select-option-verify.py
run "characterize-select-option-suggest-field" "$PY" scripts/characterization/characterize-select-option-suggest-field.py
run "characterize-close-dialog-replay" "$PY" scripts/characterization/characterize-close-dialog-replay.py
run "characterize-cascade-three-round" "$PY" scripts/characterization/characterize-cascade-three-round.py
run "characterize-dialog-tasklist-scope" "$PY" scripts/characterization/characterize-dialog-tasklist-scope.py
run "characterize-container-naming" "$PY" scripts/characterization/characterize-container-naming.py
run "characterize-result-protocol" "$PY" scripts/characterization/characterize-result-protocol.py
run "characterize-use-field" "$PY" scripts/characterization/characterize-use-field.py
run "characterize-field-value-match" "$PY" scripts/characterization/characterize-field-value-match.py
run "characterize-dual-save-section" "$PY" scripts/characterization/characterize-dual-save-section.py
run "characterize-form-assistant" "$PY" scripts/characterization/characterize-form-assistant.py
run "characterize-introduce-query-fill" "$PY" scripts/characterization/characterize-introduce-query-fill.py
run "characterize-select-state-boundary" "$PY" scripts/characterization/characterize-select-state-boundary.py
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
run "characterize-heal-locate" node scripts/characterization/characterize-heal-locate.mjs
run "characterize-heal-mode" "$PY" scripts/characterization/characterize-heal-mode.py
run "characterize-heal-decision" node scripts/characterization/characterize-heal-decision.mjs
run "characterize-sso-auth" node scripts/characterization/characterize-sso-auth.mjs
run "characterize-step-highlight" node scripts/characterization/characterize-step-highlight.mjs
run "characterize-layer-tree" node scripts/characterization/characterize-layer-tree.mjs
run "characterize-export-v3" node scripts/characterization/characterize-export-v3.mjs
run "characterize-dialog-screenshot" node scripts/characterization/characterize-dialog-screenshot.mjs
run "characterize-page-level-screenshot" node scripts/characterization/characterize-page-level-screenshot.mjs
run "characterize-phase-group-shot" "$PY" scripts/characterization/characterize-phase-group-shot.py

run "characterize-form-engine-wiring" "$PY" scripts/characterization/characterize-form-engine-wiring.py
run "characterize-done-accept-reason" "$PY" scripts/characterization/characterize-done-accept-reason.py
run "characterize-save-retry-scope" "$PY" scripts/characterization/characterize-save-retry-scope.py
run "characterize-duplicate-failure-cue" "$PY" scripts/characterization/characterize-duplicate-failure-cue.py
run "characterize-click-navigation-cue" "$PY" scripts/characterization/characterize-click-navigation-cue.py
run "characterize-confirm-notification" "$PY" scripts/characterization/characterize-confirm-notification.py
run "characterize-login-locator-fallback" "$PY" scripts/characterization/characterize-login-locator-fallback.py
run "characterize-step-region-bbox" "$PY" scripts/characterization/characterize-step-region-bbox.py
run "characterize-page-level-python" "$PY" scripts/characterization/characterize-page-level-python.py
run "characterize-before-close-screenshots" "$PY" scripts/characterization/characterize-before-close-screenshots.py
run "characterize-batch-actions" "$PY" scripts/characterization/characterize-batch-actions.py
run "characterize-export-v3-pid" node scripts/characterization/characterize-export-v3-pid.mjs
run "characterize-budget-extend" "$PY" scripts/characterization/characterize-budget-extend.py
run "characterize-export-v3-field-completeness" node scripts/characterization/characterize-export-v3-field-completeness.mjs
run "characterize-xpath-three-sources" node scripts/characterization/characterize-xpath-three-sources.mjs
run "characterize-resolve-ambiguous-region" node scripts/characterization/characterize-resolve-ambiguous-region.mjs
run "characterize-resolve-collision-titlebox" node scripts/characterization/characterize-resolve-collision-titlebox.mjs
run "characterize-log-extract" node scripts/characterization/characterize-log-extract.mjs
run "characterize-backfill" node scripts/characterization/characterize-backfill.mjs
run "characterize-refill-contract" "$PY" scripts/characterization/characterize-refill-contract.py
run "characterize-executor-orphan-reconcile" node scripts/characterization/characterize-executor-orphan-reconcile.mjs
run "characterize-system-import-json" node scripts/characterization/characterize-system-import-json.mjs
run "characterize-menu-scan" node scripts/characterization/characterize-menu-scan.mjs
run "characterize-special-element" node scripts/characterization/characterize-special-element.mjs
run "characterize-replay-batch" node scripts/characterization/characterize-replay-batch.mjs
run "characterize-record-status" node scripts/characterization/characterize-record-status.mjs
run "characterize-menu-navigation" node scripts/characterization/characterize-menu-navigation.mjs
run "characterize-page-bind" node scripts/characterization/characterize-page-bind.mjs
run "characterize-kb-store" "$PY" scripts/characterization/characterize-kb-store.py
run "characterize-kb-normalize" "$PY" scripts/characterization/characterize-kb-normalize.py
run "characterize-kb-actions" "$PY" scripts/characterization/characterize-kb-actions.py

if [ "$FAILED" -ne 0 ]; then
  echo "========================================"
  echo "verify-all: FAILED — revert the micro-step"
  exit 1
fi
echo "verify-all: ALL GREEN"
