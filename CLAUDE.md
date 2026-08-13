# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository. **AGENTS.md is the single source of truth** and applies equally here — import it first:

@AGENTS.md

If your Claude Code version does not support `@` imports, read `AGENTS.md` at the repo root before working.

Quick reminders (details in AGENTS.md):

- Product APIs: `/api/v2/*` (MySQL). Legacy `/api/trajectory` / `/api/case-data` → **410 Gone**.
- Refactor gate: `bash scripts/refactor/verify-all.sh`; core smokes: `node scripts/characterization/characterize-dedup.mjs`, `node scripts/smoke/accept-replay-apis.mjs`, `node scripts/characterization/characterize-ctrl.mjs`.
- `src/` changes require a `CHANGELOG.md` `[Unreleased]` entry (see AGENTS.md 同步约定).
- Human docs: `README.md`; frontend contract: `http://localhost:4097/api/docs`.
