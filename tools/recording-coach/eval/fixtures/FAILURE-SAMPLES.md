# Tier A failure-sample provenance

题集扩题依据（真实湿测/手册，非空想）：

| Case | Theme | Evidence |
|------|--------|----------|
| A5 | 假成功 → `BLOCKED_`，禁 `DONE` | `tmp/kb-through/**/through-report.md`（stepCount=0 / ~11s phase_done）；`tmp/product-mgmt/through-report-basicinfo*.md` |
| A6 | 前置未核 → 停 / `BLOCKED_前置未核`，禁开单 | `docs/superpowers/guides/2026-09-19-recording-coach-skill-draft.md` 派发前核查；skill `BLOCKED_前置未核` |
| A7 | 看 `steps[]` 不看仅 `recordStatus` | `tools/recording-coach/skill/references/acceptance.md`；recording-coach through-reports vs recorded 假象 |
| A8 | 诚实失败 `REJECTED_`，不得擅自重录 | skill / `acceptance.md` 诚实失败节 |

扩题规则：优先从 `tmp/**/through-report*.md` 与合约线失败回执抽主题；新增题须改 `evalVersion` 或追加 `changeLog`，并手跑 `eval-tier-a.mjs` 全绿。
