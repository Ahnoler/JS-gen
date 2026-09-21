# Design: Remove local BiB mount (global-browser spawn + control-plane CDP attach)

**Date:** 2026-09-11  
**Status:** approved (Lead: scope B + keep `USE_EXECUTOR`; approach B1)  
**Depends on:** [`2026-09-11-executor-only-bib-design.md`](2026-09-11-executor-only-bib-design.md) (503 gates already landed)

## Problem

`USE_EXECUTOR=false` is unsupported (APIs return 503), but the **local mount implementation** remains:

- `ensureGlobalBrowser` still spawns a control-plane Python agent + discovers CDP.
- `remote-bridge.attachLive` / `refreshCdpEndpoints` still connect the control plane to a local Chrome WebSocket.
- Callers such as `phase-highlight-screenshot` still fall back to `getAttachedCdpClient()`.

Dead code confuses ownership (“does the control plane still own Chrome?”) and risks accidental use.

## Goals

1. **Physically remove** control-plane local browser spawn and local CDP attach implementation.
2. Keep **`USE_EXECUTOR`** (default `true`; `false` → 503) as the product gate.
3. Keep **executor BiB** path working (WS forward / existing executor capture).
4. Keep **`state.globalBrowser`** bag for legacy readers (`busy`, `manualRecording`, …) — no field migration this knife.

## Non-goals

- Deleting the entire `src/cdp/remote-bridge/` tree (WS/screencast/state may still serve executor-facing hooks).
- Removing the `USE_EXECUTOR` env flag.
- Migrating `state.globalBrowser` → per-session state (B2 — separate refactor).
- Changing Python executor / Playwright agent code.

## Approach (B1)

| Area | Action |
|------|--------|
| `src/routes/browser-session/global-browser.js` | Remove `ensureGlobalBrowser` and spawn/stdout/CDP-discover wiring. Collapse or delete file: `teardownRemoteBridge` either inlines into `register.js` as `detachLive`+`clearCdpEndpoints`, or stays as a thin wrapper with no spawn. |
| `src/cdp/remote-bridge/index.js` | Delete local `refreshCdpEndpoints` probe body and `attachLive` CDP connect body. If WS still registers `attachLive`, make it throw a clear error (“local BiB mount removed — use executor”). `getAttachedCdpClient` returns `null` always (or remove export and fix call sites). |
| `src/services/trajectory/phase-highlight-screenshot.js` | Drop `getAttachedCdpClient()` fallback; only explicit `cdpClient` or executor RPC. |
| `USE_EXECUTOR` gates | Unchanged (lifecycle / attach / session / batch record). |
| `src/runtime/global-browser.js` + `state.globalBrowser` | **Keep**. |

## Component notes

- **Executor attach** already goes through `remote-session-service.attachLive` when `USE_EXECUTOR=true` and does **not** need local `remote-bridge.attachLive` CDP connect.
- **Broadcasts / watcher** may still read `state.globalBrowser.*`; leave as-is.
- Update any characterization that pins `global-browser.js` content (e.g. `characterize-page-level-screenshot.mjs`) if the file shrinks or moves.

## Error handling

- Local attach attempts → throw / 503-class message pointing at executor (consistent with existing `USE_EXECUTOR=false` copy).
- Phase highlight with neither `cdpClient` nor executor ids → `skipped: 'no_cdp'` (or equivalent), no silent local probe.

## Testing / acceptance

1. Cold pin (extend `characterize-executor-only-bib.mjs` or add sibling):
   - `ensureGlobalBrowser` symbol absent from tree (or file deleted).
   - Control-plane mount path no longer contains local `discoverCdp` / `gb.cdpWsUrl` connect sequence for attach.
   - Existing executor-only 503 assertions still pass.
2. `node --check` on touched modules.
3. Smoke (manual / existing BiB): `USE_EXECUTOR=true` prepare/attach + `resolve-element` still works.
4. Docs: clear `executor-only-bib` “物理删除” leftover in todo-list; one README line that local global-browser spawn is removed.

## Risks

| Risk | Mitigation |
|------|------------|
| Hidden caller of local `attachLive` | Grep + cold pin; WS hook throws loudly |
| `/api/browser/*` still assumes `gb.process` | Out of scope; dead paths stay until B2 |
| Over-delete remote-bridge WS | Only remove local CDP connect / refresh; keep screencast/input/ws-router modules |

## Out of scope follow-ups

- B2: migrate off `state.globalBrowser` bag.
- C: evaluate deleting unused remote-bridge modules after a quiet period with metrics/grep.
