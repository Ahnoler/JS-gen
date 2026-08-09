# docs 索引（2026-08-09）

本地工程文档（多数 gitignore）。**以代码 + `CHANGELOG.md` + `/api/docs` 为准**；此处是设计/计划/分析的导航。

## 活文档（先看这些）

| 文档 | 用途 |
|------|------|
| [superpowers/backlog-visible-editable-controls.md](superpowers/backlog-visible-editable-controls.md) | **可见可编辑目标线**待办与分期（T3 已做；当前 T4-P0） |
| [superpowers/specs/2026-08-09-scan-editable-summary-design.md](superpowers/specs/2026-08-09-scan-editable-summary-design.md) | T4-P0 规格（α 业务控件清单） |
| [superpowers/plans/2026-08-09-scan-editable-summary.md](superpowers/plans/2026-08-09-scan-editable-summary.md) | T4-P0 实现计划 |
| [superpowers/README.md](superpowers/README.md) | specs/plans 状态总表 |
| [superpowers/archive/README.md](superpowers/archive/README.md) | **已落地**规格/计划归档（T3 等） |

## 战略/分析（保留，已加交叉指针）

| 文档 | 用途 |
|------|------|
| [AI录制三大问题分析.md](AI录制三大问题分析.md) | 交易 35：重复填 / 入库停更 / toast 判定 |
| [AI记忆系统初始化进度.md](AI记忆系统初始化进度.md) | 记忆 P0–P2 进度；清单→Fact Pack 属 T4-P2 |
| [AI记忆系统优化方案.md](AI记忆系统优化方案.md) | 记忆设计权威 |
| [JS-gen学习Codex与PlaywrightMCP集成计划.md](JS-gen学习Codex与PlaywrightMCP集成计划.md) | MCP 愿景；a11y = T4-P4 对照，非清单主路径 |
| [JS-gen灰度测试开发计划.md](JS-gen灰度测试开发计划.md) | 灰度原则：只新增、可开关 |
| [refactor-plan.md](refactor-plan.md) | Python agent 目录重构映射 |

## 其它

| 路径 | 用途 |
|------|------|
| [report/](report/) | 试用期日报（与产品 backlog 无关） |

## 目标定稿（勿再写「要全 DOM」）

- **α** 业务控件全集（Source A/B/C + 扩展），不是裸 HTML DOM  
- 仅已分类控件可操作；壳层不进清单；清单**永不** auto-fill  
- 详见 backlog「目标定稿」
