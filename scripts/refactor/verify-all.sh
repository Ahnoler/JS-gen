#!/usr/bin/env bash
# Refactoring gate: run the core characterization/smoke suite.
# Every refactoring micro-step ends with this script; any failure stops the batch.
#   bash scripts/refactor/verify-all.sh
set -u

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
run "characterize-assembler"   python scripts/characterization/characterize-assembler-click.py
run "characterize-form-rules"  python scripts/characterization/characterize-form-rules.py
run "accept-replay-apis"       node scripts/smoke/accept-replay-apis.mjs

if [ "$FAILED" -ne 0 ]; then
  echo "========================================"
  echo "verify-all: FAILED — revert the micro-step"
  exit 1
fi
echo "verify-all: ALL GREEN"
