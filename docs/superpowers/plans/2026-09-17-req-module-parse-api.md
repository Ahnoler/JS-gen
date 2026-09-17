# Req-module parse API — Implementation Plan

> Base: `uara_V1.2`. Spec: `docs/superpowers/specs/2026-09-17-req-module-parse-api-design.md`

## Tasks

1. Commit design + this plan under docs/superpowers/
2. TDD: characterize-kb-req-parse.mjs with temp module + injectable extract/LLM
3. extract-source-text.js (+ mammoth for docx)
4. slice-req-doc.js + prompt file
5. parse-req-module.js orchestration (write chapters, through-chains, manifest, clear propose cache)
6. Wire route + api-docs; hasLocalSource on getReqModule if easy
7. verify characterization green; open PR

Out of scope: async jobs, wet full agent quality, UI Vue (API only unless trivial docs).
