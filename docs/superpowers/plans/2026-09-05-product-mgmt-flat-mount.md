# 计划：产品管理扁平挂载纠偏

> 对应 spec：`docs/superpowers/specs/2026-09-05-product-mgmt-flat-mount-design.md`

## Task 1 — 数据纠偏（主路径）

1. 快照仍挂 `9000000230` 的 trajectory。
2. `POST` 新建两叶（parent `9000000002`）+ `PUT` 写 xpath/pageId。
3. 按名称/pageId `UPDATE trajectory.function_id`（仅原 fid=0230）。
4. `PUT` `0230`/`0231`：`removedFlag=1`，清空 `0230` 的错误 menuXpath/pdCmptEcd。
5. API 验收写入 `tmp/product-mgmt/_flat_mount_verify.json`。

## Task 2 — 扫描防再发（小改）

- `buildScanApplyPlan`：若同名未命中但 **xpath(data-id) 已被另一节点占用**，不要把扫描名当「更新已有幽灵」；应 **create** 新叶（或 xpath 命中后改名为扫描文案——优先：xpath 全局唯一匹配优先于名称）。
- 补 characterization pin（若有现成 menu-scan 脚本）。

## Task 3 — 收工

- agent-log 收工 + todo-list 产品线一句。
