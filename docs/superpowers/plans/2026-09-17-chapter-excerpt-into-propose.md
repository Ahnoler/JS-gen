# Chapter Excerpt into Propose — Implementation Plan

> **For agentic workers:** TDD; commit per task; base branch = `cursor/taskdraft-atomize-prompts-e2f1` (PR #48) or `uara_V1.2` after #48 merges. Spec: `docs/superpowers/specs/2026-09-17-chapter-excerpt-into-propose-design.md`

**Goal:** Feed per-chain chapter excerpts into atomize user payload; bump cache to 8; prompt rules for projection-only use.

## File map

- Create `src/services/req-draft-traj/chapter-excerpt.js`
- Edit `propose.js` (`buildAtomizeUserPayload`, `callAtomizeLlm`)
- Edit `propose-cache.js` (v7→8)
- Edit `scripts/prompts/req-draft-traj-atomize-prompt.md`
- Add characterization script or extend existing req-draft-traj pins
- Commit spec + this plan under `docs/superpowers/`

---

### Task 1: Spec + plan in repo

- [ ] Copy approved design + this plan into `docs/superpowers/specs/` and `plans/`
- [ ] Commit

### Task 2: `buildChapterExcerpts` + failing pins (TDD)

- [ ] Write characterization that: with temp chaptersDir + chains, returns excerpt containing ZJJK/要点; empty dir → `[]`
- [ ] Implement `chapter-excerpt.js` until pins pass
- [ ] Commit

### Task 3: Wire into `buildAtomizeUserPayload`

- [ ] Async load excerpts in `callAtomizeLlm` / propose path (chaptersDir = `join(modDir,'chapters')`)
- [ ] Include `chapterExcerpts` in JSON; respect 28k budget (shrink excerpts first)
- [ ] Pin: payload string includes `"chapterExcerpts"` when chapters present
- [ ] Export `buildAtomizeUserPayload` if needed for pins (or test via chapter-excerpt only + thin propose stub)
- [ ] Bump `PROPOSE_CACHE_VERSION` to 8
- [ ] Commit

### Task 4: Prompt `<chapter_excerpts>`

- [ ] Add XML section; keep no-menu-nav and no-invent rules
- [ ] Commit

### Task 5: verify-all + PR

- [ ] Run req-draft-traj / verify-all characterization relevant suites
- [ ] Open PR into `uara_V1.2` (or update #48 if still open and stacking — prefer **new PR** from branch based on #48 head so review is clear)
- [ ] PR body: wet checklist (POST propose after pull; expect denser drafts when chapters exist)
