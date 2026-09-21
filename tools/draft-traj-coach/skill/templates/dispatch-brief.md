# 草稿交易派发 — {{MODULE_KEY}}

## 固定参数

- 控制面：`{{BASE_URL}}`（默认 `http://127.0.0.1:4097`）
- moduleKey：`{{MODULE_KEY}}`
- moduleName：`{{MODULE_NAME}}`
- 源文档：`{{SOURCE_PATH_OR_LOCAL_COPY}}`（无则写「已 sliced，跳过 parse」）
- chainIds：`{{CHAIN_IDS_OR_ALL}}`
- 证据目录：`{{EVIDENCE_DIR}}`
- systemAccountId（commit 时）：`{{SYSTEM_ACCOUNT_ID}}`
- paasUserId（可选）：`{{PAAS_USER_ID}}`

## 业务目标

{{GOAL}}

例：对 product-mgmt 主链 A 产出可独立录制的原子草稿候选；人勾选后建成 draft 交易。

## 风险预告

- **禁止**在未收到 pick-list（人确认的 atomKeys）前调用 commit。
- **禁止** prepare / record；本线终点 draft。
- **禁止**改 `chapters/`；改链仅 `through-chains.md` 且须备份。
- **闸门通过 ≠ 质量达标**；建议勾选须按 `references/taskdraft-quality.md` 金样五条分拣，薄稿进暂缓。
- 不写 `data/kb/flows`；不 git commit。
- parse/propose 超时放宽；STALE 缓存须重 propose。

## 管线步骤

1. `register_module` / `upload_source`（若需要）
2. `parse_module`（有源）或确认已 Sliced
3. `propose_atoms` → `present_pick_list`（**分拣 near_gold / thin**）
4. **停：等待编排者确认 atomKeys**（默认自 near_gold）
5. `validate_atoms` → `commit_drafts`（仅确认子集）
6. `write_through_report`

质量差或 thin 占比高：`rewrite_through_chains`（拆 OR 写能力、去菜单导航）→ 重 propose → 再 present。

## 成功判据

- 未勾选：`PROPOSED_` + 已分拣的建议清单（含 thin 标签）
- 已勾选：`COMMITTED_` + trajectoryId；若含 thin 须注明覆盖质量建议
- 质量是否「业务达标」由编排者终裁，不单凭本回合 commit

## 禁区

{{FORBIDDEN}}
