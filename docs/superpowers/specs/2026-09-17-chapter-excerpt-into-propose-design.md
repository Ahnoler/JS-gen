# Design: Chapter excerpts into draft-traj propose

**Date:** 2026-09-17  
**Status:** Approved (user)  
**Depends on:** PR #48 (atomize no-hallucination / cache v7) — implement on that branch or after merge into `uara_V1.2`

## 1. Problem

`proposeDraftTrajectories` feeds atomize only `chains[]` (step skeletons: action/page/zjjk/buttons) plus thin `flowCards`. Module `chapters/*.md` are resolved solely for provenance (`sourceChapter` / `sourceHash` / `chunkId`) and **never** appear in the LLM user payload.

Wet `product-mgmt` already has sliced chapters and through-chains; step `action`s are high-level titles. Combined with the prompt rule “do not invent UI text,” `taskDraft` collapses to 1–2 lines. Gold recorder TX quality requires field-level detail that lives in chapters (or richer chain cells), not in prompt wording alone.

## 2. Goals

- Inject **already-parsed chapter text** relevant to each chain into the atomize payload so `taskDraft` can project real fields/controls/asserts.
- Preserve no-hallucination: model may only use text present in chains, flowCards, or `chapterExcerpts`.
- When chapters are missing or unmatched, behavior matches today’s thin drafts.
- Keep JSON atom schema unchanged; bump `PROPOSE_CACHE_VERSION` (7 → 8 after #48).

## 3. Non-goals

- No new upload/parse HTTP API.
- No “enrich through-chains at parse time” in this change (follow-up).
- Do not dump entire booklet into the prompt.
- Do not require wet output to match Opencode gold TX length when chapter text is thin.

## 4. Approach (chosen)

**Per-chain chapter excerpt in `buildAtomizeUserPayload`.**

Reuse `resolveChapterRef({ chaptersDir, chapterHint, zjjk, actionHint })` once per chain (prefer first step with ZJJK; else chain.chapterHint + chain.title).

Build `chapterExcerpts: [{ chainId, fileName, ref, excerpt }]` and pass beside `chains` / `flowCards`.

### Excerpt construction

For the resolved chapter file content:

1. Prefer a contiguous window: H1 + `## 要点摘要` (or first substantive section) **plus** paragraphs/lines that mention any ZJJK code appearing in that chain’s steps.
2. Cap **per excerpt** ~2500–3000 UTF-8 chars (trim at paragraph boundary; append `\n…(truncated)` if cut).
3. Cap **aggregate** excerpts so full user JSON respects `MAX_CHAIN_PAYLOAD_CHARS` (28000). Truncation order when over budget:
   1. Shrink excerpts (shortest chains first or proportional)
   2. Existing step trim (drop `page`)
   3. Hard slice with `/* truncated */` as today

Deduplicate: if two chains resolve to the same file, still emit one excerpt entry per chainId (same text OK) **or** one shared excerpt keyed by fileName with `chainIds: []` — prefer **per-chainId** for simpler model binding.

### Prompt delta

Add a short XML section (e.g. `<chapter_excerpts>`) in `req-draft-traj-atomize-prompt.md`:

- `chapterExcerpts` are parsed requirement facts for the matching `chainId`.
- Project visible labels/buttons/fields/asserts from excerpt into `taskDraft` when writing that chain’s atoms.
- **Must not** invent controls absent from chains + excerpts + flowCards.
- If a chain has no excerpt, keep locate → one capability → one persist skeleton.

Align with PR #48 `<taskdraft_quality>` (projection, not gold-template force).

### Code touchpoints

| File | Change |
|------|--------|
| `src/services/req-draft-traj/chapter-excerpt.js` (new) | `buildChapterExcerpts({ chains, chaptersDir, maxPerExcerpt, maxTotal })` |
| `src/services/req-draft-traj/propose.js` | `buildAtomizeUserPayload` / `callAtomizeLlm` load excerpts; export helper for pins |
| `src/services/req-draft-traj/propose-cache.js` | `PROPOSE_CACHE_VERSION` 7 → 8 + comment |
| `scripts/prompts/req-draft-traj-atomize-prompt.md` | `<chapter_excerpts>` rules |
| `scripts/characterization/…` | Pins: resolve+excerpt for fixture chapters; payload includes `chapterExcerpts`; empty chapters → no field |
| `docs/superpowers/specs/2026-09-17-chapter-excerpt-into-propose-design.md` | This doc |
| `docs/superpowers/plans/2026-09-17-chapter-excerpt-into-propose.md` | Implementation plan |

Fallback path (`buildFallbackLlmAtoms`) does **not** need chapter text (deterministic templates stay thin).

## 5. Risks

- **Token budget:** large modules with many chains — mitigate with per-excerpt and aggregate caps.
- **Wrong chapter match:** reuse existing resolver scoring; do not invent a second matcher.
- **Leak menu paths from chapters:** prompt already forbids system menu nav in `taskDraft`; excerpts may mention menus — model must still omit menu nav steps.

## 6. Success criteria

- Characterization: with fixture chapters, payload JSON contains `chapterExcerpts` with non-empty `excerpt` for matched chains; without chapters dir, key absent or empty array and propose still succeeds.
- After merge + re-propose on LMY `product-mgmt` (cache v8): at least some accepted atoms’ `taskDraft` include field/tab/button strings that appear in the matched chapter and were absent from prior 1-line drafts (qualitative wet check).
- `verify-all` / req-draft-traj characterization suite green.

## 7. Wet checklist (LMY, after merge)

1. Pull branch / merge to local `uara_V1.2`.
2. Confirm `chapters/*.md` present under `data/kb/req/product-mgmt/`.
3. Restart control plane if needed; **POST** `…/draft-traj/propose` (restart alone insufficient).
4. Diff `.draft-traj-propose.json` taskDraft line density vs cache v6/v7.
