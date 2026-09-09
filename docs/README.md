# docs 索引（2026-09-08 更新）

本地工程文档（多数 gitignore）。**以代码 + git commit 历史 + `/api/docs` 为准**；此处是设计/计划/分析的导航。

## 活文档（先看这些）

| 文档 | 用途 |
|------|------|
| [superpowers/todo-list.md](superpowers/todo-list.md) | 总 TODO：当前工作线与挂起项（跨会话共享清单） |
| [superpowers/agent-log.md](superpowers/agent-log.md) | 跨 Agent 协作日志：开工/收工声明与交接 |
| [superpowers/guides/ui-record-through-line-agent-prompt.md](superpowers/guides/ui-record-through-line-agent-prompt.md) | UI 录制贯通操作手册 |
| [superpowers/guides/idle-review-prompt.md](superpowers/guides/idle-review-prompt.md) | 闲时代码审查提示词（六族检查单 + 子智能体团队） |
| [jsdoc-convention.md](jsdoc-convention.md) | JSDoc 注释规范（eslint-plugin-jsdoc 配套） |

## 设计/分析（保留）

| 文档 | 用途 |
|------|------|
| [AI记忆系统优化方案.md](AI记忆系统优化方案.md) | 记忆设计权威 |
| [830格式对齐改造spec.md](830格式对齐改造spec.md) | 伙伴平台 V3 格式对齐规格（已收官，2026-09-08 补记） |
| [报文日志捞取接口设计.md](报文日志捞取接口设计.md) | 被测系统三接口开发请求文档（已搁置；被动捕获框架资产保留） |
| [spec-phase-done-cross-run-fix.md](spec-phase-done-cross-run-fix.md) | phase_done 跨 run 串台修复规格 |

## 其它

| 路径 | 用途 |
|------|------|
| [superpowers/archive/](superpowers/archive/) | 已落地规格/计划归档（保留作决策记录） |
| [report/](report/) | 试用期日报（与产品 backlog 无关） |

## 目标定稿（勿再写「要全 DOM」）

- **α** 业务控件全集（Source A/B/C + 扩展），不是裸 HTML DOM  
- 仅已分类控件可操作；壳层不进清单；清单**永不** auto-fill  
- 历史规格/计划见 [superpowers/archive/](superpowers/archive/)（scan-editable-summary 等）
