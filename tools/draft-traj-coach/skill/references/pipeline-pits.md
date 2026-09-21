# 管线坑位

## 超时

- `parse`：同步 LLM，常 1–3+ 分钟；HTTP 客户端超时建议 ≥300s。
- `propose`：atomize LLM + 章节摘录，也可能超过默认 120s。

## 缓存与改链

- parse 成功会删除 `.draft-traj-propose.json`。
- `rewrite_through_chains` 后必须删除该缓存并重新 propose，否则 commit → `STALE_PROPOSE_CACHE` / `unknown_or_stale_atom`。
- **cacheVersion 升级**（含 v12 `sutSettledHints` 注入）会使旧缓存失效；须重 propose，勿强行 commit。

## SUT 定案文案

- propose 自动读模块目录 `wet-test.md` + 可选 `sut-settled.md`，注入 atomize 的 `sutSettledHints`。
- 按钮/查询/拦截提示冲突时跟定案，不跟文档旧词；改链同理。
- 新定案优先写入 `sut-settled.md` 短表（手维），再必要时回填 through-chains。

## Windows / curl

- Git Bash 内联中文 JSON 易 GBK 乱码 → 假 `unknown_or_stale_atom`。
- 用 UTF-8 文件 + `--data-binary @file.json`。

## functionId

- `suggestedFunctionId` 可能不是合法 `system.id`；commit 前用 overrides 兜底（湿测经验：product-mgmt 常用挂载点需人指定）。
- validate 可先暴露 `missing_function_id` / `unknown_function_id`。

## 与录制线隔离

- 本 SOP **不**占执行机槽；不要为了 draft-traj 去 `list_executors` 抢槽。
- 勿调用 `prepare_record` / `start_record`（那是 recording-coach）。

## 空转保护

同一 `chainIds`+模块连续 propose ≥3 次且 rejected 结构无改善 → `BLOCKED_纠偏无效`，改走 RefineChains 或移交人工。
