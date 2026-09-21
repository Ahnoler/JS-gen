# HTTP ↔ 预留工具对照

控制面默认 `http://127.0.0.1:4097`。契约真源：`/api/docs` KB 组。

| 预留工具 | HTTP | 备注 |
|----------|------|------|
| `register_module` | `POST /api/v2/kb/req-modules` | body: moduleKey, moduleName, sourcePath, note?, reset? |
| `upload_source` | `POST /api/v2/kb/req-modules/{moduleKey}/source` | multipart field `file` |
| `parse_module` | `POST /api/v2/kb/req-modules/{moduleKey}/parse` | 同步 LLM，客户端超时 ≥300s |
| `read_workspace` | `GET /api/v2/kb/req-modules/{moduleKey}` | 再读盘 `through-chains.md` / `chapters/` 摘要，**以及** `wet-test.md` / 可选 `sut-settled.md`（SUT 定案文案） |
| `propose_atoms` | `POST …/draft-traj/propose` | body: chainIds?, maxAtoms?；服务端注入 `sutSettledHints`（cacheVersion≥12） |
| `rewrite_through_chains` | （本地写文件） | 备份到证据目录后再写模块 `through-chains.md`；删 `.draft-traj-propose.json` |
| `present_pick_list` | （本地写文件） | 建议勾选 + rejected 表 |
| `validate_atoms` | `POST …/draft-traj/validate` | 须人确认后的 atomKeys |
| `commit_drafts` | `POST …/draft-traj/commit` | 硬闸：无确认禁止调用 |
| `write_through_report` | （本地写文件） | through-report.md + close.txt |

## 作业区路径

`data/kb/req/<moduleKey>/`：`manifest.json`、`source.link.json`、`chapters/`、`through-chains.md`、`wet-test.md`（湿测）、可选 `sut-settled.md`（定案短表，propose 注入）、`.draft-traj-propose.json`（gitignore 常见）。

## through-chains 可 propose 形态

须能被确定性解析：三级标题 `### 主链 A：…`，其后 Markdown 表至少含「步骤」「ZJJK」列；推荐表头 `| # | 步骤 | 页面/弹窗 | ZJJK | 关键按钮 |`。散文列表不可 propose。
