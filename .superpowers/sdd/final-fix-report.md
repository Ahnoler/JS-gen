# Form-field intra-slot xpath — final fix report

## Important #1 — AI/CDP persist drops field_slot / display_label

**Changes**
- `src/cdp/inspect-payload-script.js` — `elMeta` copies `field_slot` / `display_label` from `loc`.
- `src/cdp/resolve-by-label.js` — `snap` return + `buildResolveResult` copy same fields.
- `scripts/controller/actions/js_snippets/fill_core.py` — `JS_CAPTURE_FROM_XPATH` rebuilds via `buildLocatorSnap` and returns slot/locator fields.
- `scripts/controller/actions/_helpers.py` — `_capture_element` passthrough for `field_slot`, `display_label`, `locator_occurrence`, `locator_verified`, `locator_strategy`.
- `scripts/characterization/characterize-capture-element-xpath.py` — persist-layer substring pins.

## Important #2 — Offline input leaf drift

**Changes**
- `src/cdp/locator-builders/controls.js` — when `occurrence >= 1`, input leaf uses `input[not(ancestor::div[class-token el-select])]` (matches live tight leaf before `[n]`).
- `scripts/characterization/cold/characterize-locator-candidates.mjs` — pin for intra-item input tight leaf.

## Verification

```bash
node scripts/characterization/cold/characterize-form-field-intra-slot.mjs
# ok: dual select slots / dual input slots / unique field has no slot
# characterize-form-field-intra-slot: OK

D:/anaconda3/envs/browser_use/python.exe scripts/characterization/characterize-capture-element-xpath.py
# characterize-capture-element-xpath: OK

node scripts/characterization/cold/characterize-locator-candidates.mjs
# ok: form field input intra-item tight leaf (+ existing cases)
# characterize-locator-candidates: OK

node scripts/characterization/cold/characterize-locator-parity.mjs
# characterize-locator-parity: OK
```

## Self-review

- Single-control fields (`occurrence=0`) still emit bare `//input` offline; live parity test passes for bare-page fixture.
- `label_text` / `formLabel` not rewritten with `-A`; `display_label` is separate.
- `_locator_helpers_js.py` untouched (no `page-locator-helpers.js` change).
- `_capture_element` now mirrors `_enrich_click_element` slot-field passthrough.
