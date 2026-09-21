# 常见 rejected / problems 与处置

操作员读原因后纠偏；不要对编排者只回「失败了」。

| reason / code | 含义 | 建议动作 |
|---------------|------|----------|
| `multi_capability_task_draft` | 同笔多项可独立验收能力 | 拆 atom；或 RefineChains 拆步骤行 |
| `produces_eq_title` | produces 刷成 title | 重 propose；必要时改 prompt 输入密度（不改 chapters） |
| `multi_persist_task_draft` | 多次确定/保存 | 拆成多笔落库闭环 |
| `missing_depend_fields` | produces 空 | 重 propose；检查 LLM 是否丢字段 |
| `self_produce_depend` | 自产自依赖 | 拆上游/下游 atom |
| `dangling_data_depend` | 依赖键同批无 produces | 补上游 atom 或 `source: preset` 并注明人保证预置 |
| `reference_step` | 回主链/同上 | 不产原子；从建议清单排除 |
| `multi_write_atom` | 多写且非卡闭环 | 缩小 stepIndexes 或改链 |
| `unknown_or_stale_atom` | 不在新鲜 propose 缓存 | 重 propose 后再 validate |
| `STALE_PROPOSE_CACHE` | 缓存版本/源 hash 过期 | 重 propose |
| `stale_chapter_ref` | 章节漂移 | 移交切片线或重 parse；本 skill 不改 chapters |
| `missing_function_id` / `unknown_function_id` | 功能挂载缺失 | 要编排者给 functionIdOverrides |
| `duplicate_draft` | 同 atomKey 已有轨迹 | skip 或明示 force |

管线坑（超时、Windows 中文 JSON、FK）：见同目录 `pipeline-pits.md`。
