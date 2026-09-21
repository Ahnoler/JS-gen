# 验收口径

分两层：**管线验收**（下）与**草稿质量**（同目录 `taskdraft-quality.md` + 正/反例文件）。

## 合法终局前缀（管线）

| 前缀 | 含义 |
|------|------|
| `PROPOSED_` | 已 propose，且已按金样分拣写出 pick-list；人未勾选或只出候选 |
| `COMMITTED_` | validate+commit 成功；至少一条 `created[].trajectoryId` |
| `BLOCKED_` | 缺源、不可 parse、纠偏两次无效、near_gold 长期为 0 等 |
| `REJECTED_` | 控制面明确拒绝且重试耗尽 |
| `ERROR` | 工具/网络/未知异常 |

## PROPOSED_ 最低证据

1. propose 响应快照（或缓存拷贝）
2. pick-list：含 **near_gold** 与 **thin+flags** 两栏
3. rejected 摘要（可为空表）

## COMMITTED_ 最低证据

1. commit 响应 JSON（created / skipped）
2. 至少一笔轨迹摘要：`recordStatus=draft`，`reqAtomKey` 非空
3. 全程无 prepare/record
4. 若含曾标 thin 的项：报告须写「编排者覆盖质量建议」

## 禁止报成功

- 无 API 快照仅凭模型自称
- 未确认 atomKeys 却 commit
- 把整批 `duplicate_draft` 说成新建成功
- 把「闸门通过」或「已 commit」说成「已达金样」

## 质量（摘要，细则见 taskdraft-quality）

- 金样五条：进页定位、单能力、断言收尾、多步编号、业务名 produces
- 薄稿标签：`thin_one_liner`、`button_list_only`、`no_locate`、`menu_nav`、`produces_placeholder`、`no_assert`、`multi_cap_in_chain`
