# CLAUDE.md

供 Claude Code（claude.ai/code）在本仓库工作时阅读。**权威约定以 `AGENTS.md` 为准**；请先导入：

@AGENTS.md

若 Claude Code 不支持 `@` 导入，开工前先读仓库根目录 `AGENTS.md`。

**速记（细节见 AGENTS.md）：**

- 产品 API：`/api/v2/*`（MySQL）。旧 `/api/trajectory`、`/api/case-data` → **410 Gone**。
- 重构门禁：`bash scripts/refactor/verify-all.sh`；核心 smoke：`node scripts/smoke/accept-recording-apis.mjs`、`node scripts/characterization/characterize-trajectory.mjs`。
- 变更史以 git commit message 为准；根目录 `CHANGELOG.md` 仅用户指定时更新（见 AGENTS.md）。
- 面向人的文档：`README.md`；前端契约：`http://localhost:4097/api/docs`。
