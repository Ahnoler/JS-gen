#!/usr/bin/env bash
# Refactoring gate: run the core characterization/smoke suite.
# Usage:
#   bash scripts/refactor/verify-all.sh              # full suite (all domains)
#   bash scripts/refactor/verify-all.sh select,fill  # domain pipelines only
#   bash scripts/refactor/verify-all.sh --changed    # auto-select by git diff
#   VERIFY_JOBS=6 bash scripts/refactor/verify-all.sh  # tune parallelism
# Micro-step verification: run the domains your change touches
# (--changed picks them for you). Merge verification (AGENTS.md 硬约定):
# always run the FULL suite (no arguments) after git pull / merge — domain
# pipelines cannot see cross-line interference.
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

# ---------------------------------------------------------------------------
# Domain registry: pipeline name → pin entries.
# Entry format:  <name>|<command...>
#   name    : pin identifier (report/failure label)
#   command : "$PY" <script.py> | node <script.mjs> | npx eslint .
# A pin may appear in MULTIPLE pipelines when it pins contracts spanning
# domains (deliberate duplication — 防漏跑). Adding a pin: append it to every
# domain whose source files it reads; when unsure, add to `core`.
# ---------------------------------------------------------------------------
PINS_CORE='
characterize-trajectory|node scripts/characterization/characterize-trajectory.mjs
characterize-deadlock-forensics|node scripts/characterization/characterize-deadlock-forensics.mjs
characterize-bib-navigate-input|node scripts/characterization/cold/characterize-bib-navigate-input.mjs
characterize-run-event-ownership|node scripts/characterization/characterize-run-event-ownership.mjs
characterize-runid-bridge|node scripts/characterization/characterize-runid-bridge.mjs
characterize-owned-wait-shape|node scripts/characterization/characterize-owned-wait-shape.mjs
characterize-quality-final-gate|node scripts/characterization/characterize-quality-final-gate.mjs
characterize-record-phase-finalize|node scripts/characterization/characterize-record-phase-finalize.mjs
characterize-stop-semantics|node scripts/characterization/characterize-stop-semantics.mjs
characterize-record-status|node scripts/characterization/characterize-record-status.mjs
characterize-traj-recon-logging|node scripts/characterization/characterize-traj-recon-logging.mjs
characterize-step-number-integrity|node scripts/characterization/characterize-step-number-integrity.mjs
characterize-agent-llm-error|node scripts/characterization/characterize-agent-llm-error.mjs
characterize-ai-recording-boundaries|node scripts/characterization/cold/characterize-ai-recording-boundaries.mjs
'
PINS_PHASE='
characterize-phase-section-scope|"$PY" scripts/characterization/characterize-phase-section-scope.py
characterize-phase-runtime|"$PY" scripts/characterization/characterize-phase-runtime.py
characterize-recorder-phase-reset|"$PY" scripts/characterization/characterize-recorder-phase-reset.py
characterize-phase-reviewer|"$PY" scripts/characterization/characterize-phase-reviewer.py
characterize-phase-reviewer-flow|"$PY" scripts/characterization/characterize-phase-reviewer-flow.py
characterize-phase-done-runid|"$PY" scripts/characterization/characterize-phase-done-runid.py
characterize-phase-boundary|"$PY" scripts/characterization/cold/characterize-phase-boundary.py
characterize-phase-done-evidence-gate|node scripts/characterization/characterize-phase-done-evidence-gate.mjs
characterize-g3-done-gate-live|"$PY" scripts/characterization/characterize-g3-done-gate-live.py
characterize-g3-runner-seam|node scripts/characterization/characterize-g3-runner-seam.mjs
characterize-phase-save-cue-promote|"$PY" scripts/characterization/characterize-phase-save-cue-promote.py
characterize-phase-end-pending-refresh|"$PY" scripts/characterization/characterize-phase-end-pending-refresh.py
characterize-record-phase-finalize|node scripts/characterization/characterize-record-phase-finalize.mjs
characterize-reset-phase-not-query|"$PY" scripts/characterization/characterize-reset-phase-not-query.py
characterize-reset-button-guard|"$PY" scripts/characterization/characterize-reset-button-guard.py
characterize-contract-arbitration-circuit-breaker|"$PY" scripts/characterization/characterize-contract-arbitration-circuit-breaker.py
characterize-probe-donelog-and-suspect-noise|"$PY" scripts/characterization/characterize-probe-donelog-and-suspect-noise.py
characterize-wf-submit-guard-hint|"$PY" scripts/characterization/characterize-wf-submit-guard-hint.py
characterize-done-accept-reason|"$PY" scripts/characterization/characterize-done-accept-reason.py
characterize-ghost-pending-prune|"$PY" scripts/characterization/characterize-ghost-pending-prune.py
characterize-sut-spin-guard|"$PY" scripts/characterization/characterize-sut-spin-guard.py
characterize-ai-phase-element-guard|"$PY" scripts/characterization/cold/characterize-ai-phase-element-guard.py
characterize-quality-final-gate|node scripts/characterization/characterize-quality-final-gate.mjs
characterize-stop-semantics|node scripts/characterization/characterize-stop-semantics.mjs
characterize-runid-bridge|node scripts/characterization/characterize-runid-bridge.mjs
characterize-run-event-ownership|node scripts/characterization/characterize-run-event-ownership.mjs
characterize-owned-wait-shape|node scripts/characterization/characterize-owned-wait-shape.mjs
characterize-budget-extend|"$PY" scripts/characterization/characterize-budget-extend.py
characterize-done-accept-reason|"$PY" scripts/characterization/characterize-done-accept-reason.py
characterize-ai-recording-boundaries|node scripts/characterization/cold/characterize-ai-recording-boundaries.mjs
'
PINS_FILL='
characterize-form-rules|"$PY" scripts/characterization/characterize-form-rules.py
characterize-xpath-fill-select|"$PY" scripts/characterization/characterize-xpath-fill-select.py
characterize-fill-already-filled|"$PY" scripts/characterization/characterize-fill-already-filled.py
characterize-fill-err-with-scope|"$PY" scripts/characterization/characterize-fill-err-with-scope.py
characterize-fill-dispatch|"$PY" scripts/characterization/cold/characterize-fill-dispatch.py
characterize-fill-replay-engine|"$PY" scripts/characterization/cold/characterize-fill-replay-engine.py
characterize-fill-tssc-live-downgrade|"$PY" scripts/characterization/cold/characterize-fill-tssc-live-downgrade.py
characterize-manual-radio-fill|"$PY" scripts/characterization/cold/characterize-manual-radio-fill.py
characterize-introduce-query-fill|"$PY" scripts/characterization/characterize-introduce-query-fill.py
characterize-refill-contract|"$PY" scripts/characterization/characterize-refill-contract.py
characterize-form-engine-wiring|"$PY" scripts/characterization/characterize-form-engine-wiring.py
characterize-form-assistant|"$PY" scripts/characterization/characterize-form-assistant.py
characterize-form-snapshot-trigger|node scripts/characterization/characterize-form-snapshot-trigger.mjs
characterize-form-field-intra-slot|node scripts/characterization/cold/characterize-form-field-intra-slot.mjs
characterize-form-structure-container|node scripts/characterization/cold/characterize-form-structure-container.mjs
characterize-form-rules|"$PY" scripts/characterization/characterize-form-rules.py
characterize-date-range-recording|"$PY" scripts/characterization/cold/characterize-date-range-recording.py
characterize-cascade-three-round|"$PY" scripts/characterization/characterize-cascade-three-round.py
characterize-autofill-engine-result-unwrap|"$PY" scripts/characterization/characterize-autofill-engine-result-unwrap.py
characterize-dual-save-section|"$PY" scripts/characterization/characterize-dual-save-section.py
characterize-save-section|"$PY" scripts/characterization/characterize-save-section.py
characterize-save-retry-scope|"$PY" scripts/characterization/characterize-save-retry-scope.py
characterize-save-notification-classify|"$PY" scripts/characterization/characterize-save-notification-classify.py
characterize-use-field|"$PY" scripts/characterization/characterize-use-field.py
characterize-field-value-match|"$PY" scripts/characterization/characterize-field-value-match.py
characterize-field-label-resolution|"$PY" scripts/characterization/characterize-field-label-resolution.py
characterize-case-data|"$PY" scripts/characterization/characterize-case-data.py
characterize-assistant-mission-context|"$PY" scripts/characterization/characterize-assistant-mission-context.py
characterize-form-assistant|"$PY" scripts/characterization/characterize-form-assistant.py
'
PINS_SELECT='
characterize-select-option-substring|"$PY" scripts/characterization/characterize-select-option-substring.py
characterize-select-option-stamp|"$PY" scripts/characterization/characterize-select-option-stamp.py
characterize-select-already-matched-dedup|"$PY" scripts/characterization/characterize-select-already-matched-dedup.py
characterize-select-option-verify|"$PY" scripts/characterization/characterize-select-option-verify.py
characterize-select-option-suggest-field|"$PY" scripts/characterization/characterize-select-option-suggest-field.py
characterize-select-state-boundary|"$PY" scripts/characterization/characterize-select-state-boundary.py
characterize-select-dispatch|"$PY" scripts/characterization/cold/characterize-select-dispatch.py
characterize-select-replay-engine|"$PY" scripts/characterization/cold/characterize-select-replay-engine.py
characterize-prefix-label-select|"$PY" scripts/characterization/cold/characterize-prefix-label-select.py
characterize-prefix-label-xpath|"$PY" scripts/characterization/cold/characterize-prefix-label-xpath.py
characterize-tssc-field-resolution|"$PY" scripts/characterization/characterize-tssc-field-resolution.py
characterize-tssc-multi-select|"$PY" scripts/characterization/cold/characterize-tssc-multi-select.py
characterize-tssc-route-conflict|"$PY" scripts/characterization/characterize-tssc-route-conflict.py
characterize-field-label-resolution|"$PY" scripts/characterization/characterize-field-label-resolution.py
characterize-use-field|"$PY" scripts/characterization/characterize-use-field.py
characterize-field-value-match|"$PY" scripts/characterization/characterize-field-value-match.py
characterize-select-option-suggest-field|"$PY" scripts/characterization/characterize-select-option-suggest-field.py
characterize-radio-replay-engine|"$PY" scripts/characterization/cold/characterize-radio-replay-engine.py
characterize-picker-atomic-recording|"$PY" scripts/characterization/cold/characterize-picker-atomic-recording.py
characterize-picker-close-clears-section|"$PY" scripts/characterization/characterize-picker-close-clears-section.py
characterize-close-dialog-replay|"$PY" scripts/characterization/characterize-close-dialog-replay.py
characterize-introduce-dialog-close|"$PY" scripts/characterization/cold/characterize-introduce-dialog-close.py
'
PINS_CLICK='
characterize-real-click|"$PY" scripts/characterization/characterize-real-click.py
characterize-idempotent-click-gate|"$PY" scripts/characterization/characterize-idempotent-click-gate.py
characterize-click-replay-engine|"$PY" scripts/characterization/cold/characterize-click-replay-engine.py
characterize-click-navigation-cue|"$PY" scripts/characterization/characterize-click-navigation-cue.py
characterize-duplicate-failure-cue|"$PY" scripts/characterization/characterize-duplicate-failure-cue.py
characterize-search-then-click-guard|"$PY" scripts/characterization/cold/characterize-search-then-click-guard.py
characterize-search-then-click-prompts|"$PY" scripts/characterization/cold/characterize-search-then-click-prompts.py
characterize-login-action|"$PY" scripts/characterization/characterize-login-action.py
characterize-login-locator-fallback|"$PY" scripts/characterization/characterize-login-locator-fallback.py
'
PINS_XPATH='
characterize-capture-element-xpath|"$PY" scripts/characterization/characterize-capture-element-xpath.py
characterize-xpath-primary-ops|"$PY" scripts/characterization/characterize-xpath-primary-ops.py
characterize-xpath-three-sources|node scripts/characterization/characterize-xpath-three-sources.mjs
characterize-replay-params-xpath|"$PY" scripts/characterization/characterize-replay-params-xpath.py
characterize-region-tree|node scripts/characterization/characterize-region-tree.mjs
characterize-region-section-alias|"$PY" scripts/characterization/characterize-region-section-alias.py
characterize-resolve-ambiguous-region|node scripts/characterization/characterize-resolve-ambiguous-region.mjs
characterize-resolve-collision-titlebox|node scripts/characterization/characterize-resolve-collision-titlebox.mjs
characterize-resolve-placeholder-search|node scripts/characterization/cold/characterize-resolve-placeholder-search.mjs
characterize-container-naming|"$PY" scripts/characterization/characterize-container-naming.py
characterize-dialog-tasklist-scope|"$PY" scripts/characterization/characterize-dialog-tasklist-scope.py
characterize-inventory-memory|"$PY" scripts/characterization/characterize-inventory-memory.py
characterize-domtree-occlusion|node scripts/characterization/characterize-domtree-occlusion.mjs
characterize-heal-locate|node scripts/characterization/characterize-heal-locate.mjs
characterize-heal-mode|"$PY" scripts/characterization/characterize-heal-mode.py
characterize-heal-decision|node scripts/characterization/characterize-heal-decision.mjs
'
PINS_TREE='
characterize-tree-check-confirm|"$PY" scripts/characterization/characterize-tree-check-confirm.py
characterize-tree-select-record|"$PY" scripts/characterization/characterize-tree-select-record.py
characterize-tree-node-text|node scripts/characterization/cold/characterize-tree-node-text.mjs
characterize-tree-text-export|node scripts/characterization/cold/characterize-tree-text-export.mjs
'
PINS_KB='
characterize-kb-store|"$PY" scripts/characterization/characterize-kb-store.py
characterize-kb-normalize|"$PY" scripts/characterization/characterize-kb-normalize.py
characterize-kb-actions|"$PY" scripts/characterization/characterize-kb-actions.py
characterize-kb-recall|"$PY" scripts/characterization/characterize-kb-recall.py
characterize-kb-insights|node scripts/characterization/characterize-kb-insights.mjs
characterize-kb-req-modules|node scripts/characterization/characterize-kb-req-modules.mjs
characterize-kb-req-parse|node scripts/characterization/characterize-kb-req-parse.mjs
characterize-req-draft-traj|node scripts/characterization/characterize-req-draft-traj.mjs
characterize-req-draft-fk-guard|node scripts/characterization/characterize-req-draft-fk-guard.mjs
characterize-flow-card-recall|node scripts/characterization/characterize-flow-card-recall.mjs
characterize-kb-recall-eval|node scripts/characterization/characterize-kb-recall-eval.mjs
characterize-atom-keydata|node scripts/characterization/characterize-atom-keydata.mjs
characterize-atom-depend|node scripts/characterization/characterize-atom-depend.mjs
characterize-persist-boundary|node scripts/characterization/characterize-persist-boundary.mjs
characterize-capability-cohesion|node scripts/characterization/characterize-capability-cohesion.mjs
characterize-network-capture|node scripts/characterization/characterize-network-capture.mjs
characterize-kb-staging|"$PY" scripts/characterization/characterize-kb-staging.py
characterize-kb-promote|"$PY" scripts/characterization/characterize-kb-promote.py
characterize-req-draft-fk-guard|node scripts/characterization/characterize-req-draft-fk-guard.mjs
'
PINS_EXECUTOR='
characterize-executor-orphan-reconcile|node scripts/characterization/characterize-executor-orphan-reconcile.mjs
characterize-executor-unknown-session|node scripts/characterization/characterize-executor-unknown-session.mjs
characterize-executor-duplicate-uuid|node scripts/characterization/characterize-executor-duplicate-uuid.mjs
characterize-executor-only-bib|node scripts/characterization/cold/characterize-executor-only-bib.mjs
characterize-remove-local-bib-mount|node scripts/characterization/cold/characterize-remove-local-bib-mount.mjs
characterize-bib-navigate-input|node scripts/characterization/cold/characterize-bib-navigate-input.mjs
characterize-chrome-proxy-flag|"$PY" scripts/characterization/characterize-chrome-proxy-flag.py
characterize-session-lifecycle|node scripts/characterization/characterize-session-lifecycle.mjs
characterize-sso-auth|node scripts/characterization/characterize-sso-auth.mjs
characterize-replay-terminal-abort|node scripts/characterization/characterize-replay-terminal-abort.mjs
characterize-replay-batch|node scripts/characterization/characterize-replay-batch.mjs
'
PINS_UI='
characterize-step-highlight|node scripts/characterization/characterize-step-highlight.mjs
characterize-layer-tree|node scripts/characterization/characterize-layer-tree.mjs
characterize-dialog-screenshot|node scripts/characterization/characterize-dialog-screenshot.mjs
characterize-page-level-screenshot|node scripts/characterization/characterize-page-level-screenshot.mjs
characterize-page-level-python|"$PY" scripts/characterization/characterize-page-level-python.py
characterize-before-close-screenshots|"$PY" scripts/characterization/characterize-before-close-screenshots.py
characterize-phase-group-shot|"$PY" scripts/characterization/characterize-phase-group-shot.py
characterize-step-region-bbox|"$PY" scripts/characterization/characterize-step-region-bbox.py
characterize-step-notice-scan|"$PY" scripts/characterization/cold/characterize-step-notice-scan.py
characterize-step-move|node scripts/characterization/characterize-step-move.mjs
characterize-sys-msg|node scripts/characterization/characterize-sys-msg.mjs
characterize-batch-import|node scripts/characterization/characterize-batch-import.mjs
characterize-batch-actions|"$PY" scripts/characterization/characterize-batch-actions.py
characterize-confirm-notification|"$PY" scripts/characterization/characterize-confirm-notification.py
characterize-click-navigation-cue|"$PY" scripts/characterization/characterize-click-navigation-cue.py
'
PINS_EXPORT='
characterize-export-v3|node scripts/characterization/characterize-export-v3.mjs
characterize-export-v3-pid|node scripts/characterization/characterize-export-v3-pid.mjs
characterize-export-v3-field-completeness|node scripts/characterization/characterize-export-v3-field-completeness.mjs
characterize-transaction-export-region|node scripts/characterization/characterize-transaction-export-region.mjs
characterize-system-import-json|node scripts/characterization/characterize-system-import-json.mjs
characterize-menu-scan|node scripts/characterization/characterize-menu-scan.mjs
characterize-menu-scan-uml-adopt|node scripts/characterization/characterize-menu-scan-uml-adopt.mjs
characterize-menu-uml-ecd-nav-guard|node scripts/characterization/characterize-menu-uml-ecd-nav-guard.mjs
characterize-menu-navigation|node scripts/characterization/characterize-menu-navigation.mjs
characterize-page-bind|node scripts/characterization/characterize-page-bind.mjs
characterize-special-element|node scripts/characterization/characterize-special-element.mjs
'
PINS_MISC='
characterize-control-ops-closed-loop|"$PY" scripts/characterization/characterize-control-ops-closed-loop.py
characterize-result-protocol|"$PY" scripts/characterization/characterize-result-protocol.py
characterize-wf-submit-guard-hint|"$PY" scripts/characterization/characterize-wf-submit-guard-hint.py
characterize-contract-arbitration-circuit-breaker|"$PY" scripts/characterization/characterize-contract-arbitration-circuit-breaker.py
characterize-save-notification-classify|"$PY" scripts/characterization/characterize-save-notification-classify.py
characterize-probe-donelog-and-suspect-noise|"$PY" scripts/characterization/characterize-probe-donelog-and-suspect-noise.py
characterize-scan-editable-summary|"$PY" scripts/characterization/characterize-scan-editable-summary.py
characterize-scan-fullpage-p1|"$PY" scripts/characterization/characterize-scan-fullpage-p1.py
characterize-scan-fullpage-p2|"$PY" scripts/characterization/characterize-scan-fullpage-p2.py
characterize-transaction-export-region|node scripts/characterization/characterize-transaction-export-region.mjs
characterize-export-v3|node scripts/characterization/characterize-export-v3.mjs
characterize-export-v3-pid|node scripts/characterization/characterize-export-v3-pid.mjs
characterize-export-v3-field-completeness|node scripts/characterization/characterize-export-v3-field-completeness.mjs
characterize-manual-radio-fill|"$PY" scripts/characterization/cold/characterize-manual-radio-fill.py
characterize-element-dedup-scope|"$PY" scripts/characterization/cold/characterize-element-dedup-scope.py
characterize-search-then-click-guard|"$PY" scripts/characterization/cold/characterize-search-then-click-guard.py
characterize-search-then-click-prompts|"$PY" scripts/characterization/cold/characterize-search-then-click-prompts.py
characterize-tssc-route-conflict|"$PY" scripts/characterization/characterize-tssc-route-conflict.py
characterize-log-extract|node scripts/characterization/characterize-log-extract.mjs
characterize-backfill|node scripts/characterization/characterize-backfill.mjs
characterize-refill-contract|"$PY" scripts/characterization/characterize-refill-contract.py
characterize-system-import-json|node scripts/characterization/characterize-system-import-json.mjs
characterize-form-field-intra-slot|node scripts/characterization/cold/characterize-form-field-intra-slot.mjs
characterize-form-structure-container|node scripts/characterization/cold/characterize-form-structure-container.mjs
characterize-recording-coach-assert|node scripts/characterization/cold/characterize-recording-coach-assert.mjs
characterize-recording-coach-operator|node scripts/characterization/cold/characterize-recording-coach-operator.mjs
characterize-recording-coach-skill-pack|node scripts/characterization/cold/characterize-recording-coach-skill-pack.mjs
characterize-recording-coach-tier-a-score|node scripts/characterization/cold/characterize-recording-coach-tier-a-score.mjs
'
# eslint/ruff run in every invocation (cheap, catches merge-orphan defects).
PINS_STATIC='
eslint-core|npx eslint .
ruff-f821|ruff check --select F821 scripts/
'

# Baseline reds (2026-09-16 本机基线，非回归): these pins are expected to fail
# locally; report them as "KNOWN-RED (baseline)" instead of failing the run.
KNOWN_BASELINE_RED='characterize-step-highlight characterize-layer-tree characterize-confirm-notification'

ALL_DOMAINS="core phase fill select click xpath tree kb executor ui export misc"
DOMAIN_VARS() {
  case "$1" in
    core)     echo "$PINS_CORE";;
    phase)    echo "$PINS_PHASE";;
    fill)     echo "$PINS_FILL";;
    select)   echo "$PINS_SELECT";;
    click)    echo "$PINS_CLICK";;
    xpath)    echo "$PINS_XPATH";;
    tree)     echo "$PINS_TREE";;
    kb)       echo "$PINS_KB";;
    executor) echo "$PINS_EXECUTOR";;
    ui)       echo "$PINS_UI";;
    export)   echo "$PINS_EXPORT";;
    misc)     echo "$PINS_MISC";;
    *) return 1;;
  esac
}

# Wire phase-domain variable (defined above with the other domain blocks).

# ---------------------------------------------------------------------------
# Domain selection. --changed maps git-diff'd source files to domains via
# path rules (conservative: one pin's domain matches → run that domain).
# ---------------------------------------------------------------------------
if [ "${1:-}" = "--changed" ]; then
  CHANGED=$( { git diff --name-only HEAD 2>/dev/null; git diff --name-only --cached 2>/dev/null; } | sort -u )
  [ -z "$CHANGED" ] && CHANGED=$(git diff --name-only HEAD~1 2>/dev/null)
  DOMAIN_HINTS=""
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    case "$f" in
      scripts/state.py|scripts/recorder.py|scripts/session_runner.py|scripts/agent/*|scripts/prompts/*) DOMAIN_HINTS="$DOMAIN_HINTS core phase";;
      scripts/controller/actions/phase/*|scripts/controller/actions/boundary*|scripts/controller/actions/classify*) DOMAIN_HINTS="$DOMAIN_HINTS phase";;
      scripts/controller/actions/fill*|scripts/controller/actions/form*|scripts/controller/actions/_form*|scripts/controller/actions/cascade*|scripts/controller/actions/autofill*|scripts/controller/actions/save*|scripts/controller/actions/*case_data*) DOMAIN_HINTS="$DOMAIN_HINTS fill";;
      scripts/controller/actions/select*|scripts/controller/actions/tssc*|scripts/controller/actions/radio*|scripts/controller/actions/picker*|scripts/controller/actions/close_dialog*) DOMAIN_HINTS="$DOMAIN_HINTS select";;
      scripts/controller/actions/click*|scripts/controller/actions/search*|scripts/controller/actions/login*) DOMAIN_HINTS="$DOMAIN_HINTS click";;
      src/cdp/*|scripts/controller/actions/js_snippets/*|scripts/controller/actions/_js_snippets*|scripts/controller/actions/inventory*|scripts/controller/actions/resolve*|scripts/controller/actions/heal*|scripts/controller/actions/region*) DOMAIN_HINTS="$DOMAIN_HINTS xpath";;
      scripts/controller/actions/tree*|src/**tree**) DOMAIN_HINTS="$DOMAIN_HINTS tree";;
      src/services/kb/*|src/kb/*|scripts/kb/*|data/kb/*|src/routes/v2/*req-draft*|src/services/req-draft-traj/*) DOMAIN_HINTS="$DOMAIN_HINTS kb";;
      executor/*|src/executor*|src/services/session-lifecycle*|src/cdp/inspect*) DOMAIN_HINTS="$DOMAIN_HINTS executor";;
      src/routes/v2/*|src/services/trajectory/*|src/dao/*) DOMAIN_HINTS="$DOMAIN_HINTS ui export core";;
      src/export*|src/services/*export*|src/services/*menu*|src/services/*import*|src/routes/*menu*|src/routes/*system*) DOMAIN_HINTS="$DOMAIN_HINTS export";;
      src/dashboard/*|public/*|src/services/*screenshot*|src/services/*highlight*) DOMAIN_HINTS="$DOMAIN_HINTS ui";;
      *) DOMAIN_HINTS="$DOMAIN_HINTS core";;
    esac
  done <<< "$CHANGED"
  # Default to full suite when nothing maps (safety over speed).
  DOMAINS=()
  for d in $DOMAIN_HINTS; do
    case " ${DOMAINS[*]:-} " in *" $d "*) ;; *) DOMAINS+=("$d");; esac
  done
  if [ "${#DOMAINS[@]}" -eq 0 ]; then
    echo "verify-all --changed: no domain mapped from diff, running FULL suite"
    DOMAINS=($ALL_DOMAINS)
  fi
  echo "verify-all --changed: mapped domains = [${DOMAINS[*]}]"
elif [ $# -gt 0 ]; then
  IFS=',' read -r -a DOMAINS <<< "$1"
else
  DOMAINS=()
fi

collect_pins() {
  # Populates global PINS with unique pin entries from selected domains.
  PINS=""
  local seen="/tmp/verify-all-seen.$$"
  : > "$seen"
  for d in "${DOMAINS[@]}"; do
    local body
    body=$(DOMAIN_VARS "$d") || { echo "verify-all: unknown domain '$d' (valid: $ALL_DOMAINS)" >&2; exit 2; }
    while IFS= read -r entry; do
      [ -z "$entry" ] && continue
      local nm="${entry%%|*}"
      grep -qxF "$nm" "$seen" && continue
      echo "$nm" >> "$seen"
      PINS+="$entry"$'\n'
    done <<< "$body"
  done
  rm -f "$seen"
}

if [ "${#DOMAINS[@]}" -gt 0 ]; then
  collect_pins
else
  # Full suite = every domain, in a stable order.
  DOMAINS=($ALL_DOMAINS)
  collect_pins
fi

# ---------------------------------------------------------------------------
# Execution. Small-batch parallelism (VERIFY_JOBS, default 4): pins are
# self-isolated (mkdtemp / headless chromium without fixed ports), so limited
# concurrency is safe; browser-launching pins are the wall-time eaters and
# benefit most. Set VERIFY_JOBS=1 for strict serial (debugging races).
# ---------------------------------------------------------------------------
JOBS="${VERIFY_JOBS:-4}"
FAILED=0
OUT_DIR="/tmp/verify-all-$$"
mkdir -p "$OUT_DIR"

run_one() {
  local entry="$1" desc cmd
  desc="${entry%%|*}"
  cmd="${entry#*|}"
  echo "=== $desc ==="
  if ! eval "$cmd" > "$OUT_DIR/$desc.log" 2>&1; then
    # Baseline-red? Expected failure — annotate, do not fail the run.
    if echo " $KNOWN_BASELINE_RED " | grep -q " $desc "; then
      echo "△ KNOWN-RED (baseline, non-regression): $desc"
    else
      echo "!! FAILED: $desc"
      FAILED=1
    fi
  else
    tail -1 "$OUT_DIR/$desc.log"
    echo "ok: $desc"
  fi
}

# Serial for static gates first (fail fast on syntax/orphan errors).
run_one "eslint-core|npx eslint ."
if command -v ruff >/dev/null 2>&1; then
  run_one "ruff-f821|ruff check --select F821 scripts/"
else
  echo "skip: ruff-f821 (ruff not on PATH)"
fi

# Parallel workers over the selected pins.
pin_list=()
while IFS= read -r entry; do
  [ -z "$entry" ] && continue
  pin_list+=("$entry")
done <<< "$PINS"

active=0
for entry in "${pin_list[@]}"; do
  run_one "$entry" &
  active=$((active + 1))
  if [ "$active" -ge "$JOBS" ]; then
    wait -n
    active=$((active - 1))
  fi
done
wait

# Report failures with excerpts, and a run summary.
status=0
echo "========================================"
echo "verify-all: domains=[${DOMAINS[*]}] pins=${#pin_list[@]} + statics"
if [ "$FAILED" -ne 0 ]; then
  echo "verify-all: FAILED — revert the micro-step (or fix before merge)"
  for f in "$OUT_DIR"/*.log; do
    desc=$(basename "$f" .log)
    if [ -s "$f" ]; then
      echo "----- $desc (tail) -----"
      tail -20 "$f"
    fi
  done
  status=1
else
  echo "verify-all: ALL GREEN (baseline reds excluded: $KNOWN_BASELINE_RED)"
fi
rm -rf "$OUT_DIR"
exit $status
