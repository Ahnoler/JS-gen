# Design: Sync req-module parse API (MVP)

**Date:** 2026-09-17  
**Status:** Approved (user chose sync parse MVP)  
**Branch base:** `uara_V1.2`

## Problem

UI pipeline needs: register module → upload source → **parse/slice** → propose candidates.  
Today: `POST …/req-modules`, `POST …/source`, `POST …/draft-traj/propose` exist; **parse is missing** (offline `req-doc-to-kb` skill only). Propose can run on stale `through-chains.md` without a fresh upload.

## Goal

Add **synchronous** `POST /api/v2/kb/req-modules/:moduleKey/parse` that:

1. Resolves uploaded `source.link.json.localCopy` (preferred) or readable `sourcePath`
2. Extracts plain text from the source (`.md`/`.txt`/`docx` MVP; other types → clear 400)
3. Calls LLM to produce `chapters/*.md` + proposeable `through-chains.md`
4. Sets `manifest.status = "sliced"`, updates `updatedAt`
5. Returns whether `canProposeAtoms` (deterministic table parse)

Then existing propose works on fresh slice.

## Non-goals (MVP)

- Async job queue / progress SSE
- Full wet-test.md / drafts / promote flows
- Perfect parity with offline `req-doc-to-kb` agent quality
- Changing atomize schema or chapter-excerpt logic
- Auto-propose in the same request (keep steps separate)

## API

```
POST /api/v2/kb/req-modules/:moduleKey/parse
Content-Type: application/json
Body (optional): { "force": false }
```

**Preconditions**

- Module exists
- `localCopy` file exists under module dir, OR `sourcePath` is readable on server
- If `chapters/` + `through-chains.md` already exist and `force !== true` → still re-parse (MVP: always rewrite slice artifacts; `force` reserved for future “refuse if sliced” — implement as: without force, warn but overwrite; OR require force to overwrite — **prefer: always overwrite slice outputs on parse; document that propose cache is invalidated** by deleting `.draft-traj-propose.json` or bumping a slice hash note)

**Success 200**

```json
{
  "moduleKey": "product-mgmt",
  "status": "sliced",
  "sourceDoc": "source/K01….docx",
  "chapterCount": 6,
  "chainCount": 4,
  "canProposeAtoms": true,
  "warnings": []
}
```

**Errors**

- 404 module not found
- 400 no source (`SOURCE_REQUIRED`)
- 400 unsupported type / extract failed
- 400 LLM output missing proposeable step tables (`SLICE_INVALID`)
- 502/500 LLM failure

## Implementation sketch

| Piece | Path |
|-------|------|
| Extract text | `src/services/kb-req-parse/extract-source-text.js` — md/txt readFile; docx via `mammoth` (add dependency) |
| Slice LLM | `src/services/kb-req-parse/slice-req-doc.js` — prompt + `callLLM` + parse JSON `{ chapters, throughChainsMarkdown }` |
| Prompt | `scripts/prompts/req-module-parse-prompt.md` — output chapters + through-chains **must** match `through-chains-proposeable-format.md` (markdown tables with 步骤/ZJJK columns) |
| Orchestrate | `src/services/kb-req-parse/parse-req-module.js` — write files, update manifest, delete propose cache |
| Route | `src/routes/v2/kb.js` — wire POST parse before propose routes |
| Docs | `src/dashboard/api-docs/groups/kb.js` |
| Pins | `scripts/characterization/characterize-kb-req-parse.mjs` — fixture `.md` source → parse with injectable LLM → assert files + canProposeAtoms |

### LLM contract (strict)

Model returns **one JSON object** (no markdown fence):

```json
{
  "chapters": [
    { "fileName": "01-概述.md", "content": "# …\n\n## 要点摘要\n…" }
  ],
  "throughChainsMarkdown": "# 视图2：…\n\n### 主链 A：…\n\n| # | 步骤 | 页面/弹窗 | ZJJK | 关键按钮 |\n|---|------|-----------|------|----------|\n| 1 | … | … | ZJJK… | … |\n"
}
```

Rules in prompt: no system-menu-only chains as sole content; at least one table-format chain; ZJJK from source when present; do not invent page codes; chapter fileNames `NN-slug.md`.

Truncate extracted source text to ~80–100k chars for LLM with clear `warnings: ["source_truncated"]`.

### List/detail enrichment (small)

`getReqModule` / list: expose `hasLocalSource: boolean` (localCopy exists) alongside existing `hasThroughChains` / `canProposeAtoms` / `status` so UI can enforce upload → parse → propose.

## Success criteria

- Cold pins green with fake LLM
- api-docs lists parse
- Manual wet (optional): upload K01 → parse → propose on empty-ish module or force re-slice product-mgmt

## Wet note

Parse may take 1–3+ minutes (LLM). Sync is OK for MVP; document client timeout.
