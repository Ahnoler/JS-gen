# Final resolve-element fix report

## 2026-08-10 — I2 / I1 / M1 / M2 / M3

**Status:** Done

### Commits

| Repo | Branch | SHA | Message |
|------|--------|-----|---------|
| JS-gen | V2.1_dev | `e762dfc` | fix: gate resolveTrajectoryElement actionType to supported set |
| Vue | dev | `086f620` | fix: clarify auto-grab disabled reason copy |

### Changes

- **I2:** `resolveTrajectoryElement` now imports `SUPPORTED_RESOLVE_ACTIONS` from `src/cdp/resolve-by-label.js`, normalizes via `normalizeActionName`, returns 400 if actionType missing/unsupported, and requires needle (`labelText` or `params.text|label_text|menu_text|button_text`) before attach/CDP dispatch.
- **I1/M1:** `recording.js` `respExample` aligned with click `reqExample` (对公客户管理 / `click_element_by_index` / menu_item).
- **M2:** `catalog.js` `RECORDING_FLOW` resolve-element step mentions `actionType+params`.
- **M3:** Vue `OperationDialog.vue` disabled-reason copy includes `button_text`.

### Tests

```
node scripts/characterization/characterize-resolve-element-auto-grab.mjs  # PASS
node scripts/characterization/characterize-locator-candidates.mjs           # OK
```

### Concerns

- Executor path (`session.bib_resolve_element`) relies on executor-side validation; service layer now gates before send but executor should mirror the same supported-action set.
- No wet BiB / live attach verification in this pass (characterization only).
