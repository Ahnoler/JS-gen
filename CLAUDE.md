# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository. **AGENTS.md is the single source of truth** and applies equally here — import it first:

@AGENTS.md

If your Claude Code version does not support `@` imports, read `AGENTS.md` at the repo root before working.

Quick reminders (details in AGENTS.md):

- Product APIs: `/api/v2/*` (MySQL). Legacy `/api/trajectory` / `/api/case-data` → **410 Gone**.
- Refactor gate: `bash scripts/refactor/verify-all.sh`; core smokes: `node scripts/characterization/characterize-dedup.mjs`, `node scripts/smoke/accept-recording-apis.mjs`, `node scripts/characterization/characterize-trajectory.mjs`.
- 变更史以翔实的 git commit message 为准（CHANGELOG.md 已于 2026-09-04 废除，不要重建）。
- Human docs: `README.md`; frontend contract: `http://localhost:4097/api/docs`.
