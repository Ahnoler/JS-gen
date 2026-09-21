# 产品库 / 要素库 — 修改 + 删除原子草稿交易设计

> 日期：2026-09-09  
> 状态：已批准（修改范围 A + 删除 Del-A；用户「继续」）  
> Lead：本会话 Cursor  
> 前置：fill 录放统一 SDD 已收工（agent-log 16:15）

## 1. 目标

为以下两功能各补 **修改** 与 **删除** 原子贯通草稿（共 **四笔**），填补既有「新增」类交易（#499 / split-499 / #503）缺口：

| ID | 功能 | functionId | 动作 |
|----|------|------------|------|
| **D1** | 产品库管理 | `9000000740` | 未启用产品「基本信息」【保存】 |
| **D2** | 产品要素库 | `9000000468` | 要素列表【修改】弹窗保存 |
| **Del1** | 产品库管理 | `9000000740` | 未启用且无下级 →【删除】确认 |
| **Del2** | 产品要素库 | `9000000468` | 未引用测试要素 →【删除】确认 |

成功判据：业务证据（toast / 回显 / 树或列表变化）+ `stepCount>0`；不认单纯 `phase_done`。

## 2. 决策摘要

| 项 | 选择 |
|----|------|
| 修改 | **A**：0740 基本信息保存；0468 修改要素行 |
| 删除 | **Del-A**：0740 删未启用无下级；0468 删未引用要素行 |
| 粒度 | 方案 1：四笔独立原子交易 |
| 账号 | `systemAccountId=2` |
| stamp 前缀 | `20260909-mod` / `20260909-del` |
| 正式卡 | 补录成功前不改 `product_library.json` / `product_element.json`；成功后另回写 source |

## 3. 范围

### In

- 任务文案：`tmp/product-mgmt/draft-mod-del/task-*.md`
- analyze → create（draft）→（执行机可用时）prepare / start / detach
- through-report 汇总

### Out

- 【产品修改】出新版本、删分组/组件树节点（非要素行）、启用/禁用/克隆
- 改 fill/select 引擎、菜单 umlEcd 线
- 本单元不强制改正式 KB flows（可后续单开）

## 4. 目标对象约定

| 交易 | 优先目标 | 若缺失 |
|------|----------|--------|
| D1 | 未启用产品 `KB测产品-20260907-1835`（或任意未启用叶子） | 报告阻塞；勿在本单启用态上硬改 |
| D2 | 既有组件下任意可改要素行（湿测「担保方式」等） | 以弹窗实见可编辑字段为准至少改一处 |
| Del1 | 专用待删：`KB测待删产品-20260909-del`（未启用、无子） | **前置造数**：可先跑一笔极短「仅新增待删产品」prep（不计入四笔验收）或手工造数 |
| Del2 | 专用待删要素名含 `KB测待删要素-20260909-del` | 同上，需未被产品引用 |

## 5. 任务文案位置

| ID | 文件 |
|----|------|
| D1 | `tmp/product-mgmt/draft-mod-del/task-d1-lib-basic-save.md` |
| D2 | `tmp/product-mgmt/draft-mod-del/task-d2-elmt-modify.md` |
| Del1 | `tmp/product-mgmt/draft-mod-del/task-del1-lib-delete.md` |
| Del2 | `tmp/product-mgmt/draft-mod-del/task-del2-elmt-delete.md` |

## 6. 补录顺序建议

1. D1 → D2（修改，不毁数据）  
2. 确认 Del 目标存在  
3. Del1 → Del2（破坏性，放最后）

每笔：`analyze` → `create` → `prepare` → `record/start` → CDP/业务核 → `detach`。

## 7. 风险

- 执行机须 **online 且 connected**；仅 heartbeat online 不够。  
- D2 弹窗可能与文档 drift（叶4）；门闩写「至少改一处可编辑字段」。  
- Del 误删生产数据：目标名必须带 `KB测待删` stamp。  
- record/start 假成功：以 stepCount + 业务证据为准。
