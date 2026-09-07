# 实施计划：扫描同名升格 intermediate（合入）

> 日期：2026-09-05  
> Spec：`docs/superpowers/specs/2026-09-05-intermediate-promote-on-scan-design.md`  
> 目标：同名可点叶合入 json intermediate 节点，不新建 AI 孪生；`source` 保持 `json_import`

## 文件地图

| 文件 | 职责 |
|------|------|
| `src/services/menu-scan-service.js` | `buildScanApplyPlan`：未命中可导航时，同名 intermediate → updates（升格） |
| `src/services/menu-scan-apply.js` | 落库 updates 时写 `intermediateFlag=0`；不改 source/umlEcd |
| `src/services/menu-scan-session.js` | `loadExistingModules` 须把 intermediate 子节点带进 children（供匹配） |
| `scripts/characterization/characterize-menu-scan.mjs` | 升格 / 不误升格 / 仍 create 异名 |
| `scripts/maintenance/merge-intermediate-ai-twins.mjs` | 存量孪生清理（systemId=1：`7`←`1478`） |
| `src/dashboard/api-docs/groups/overview.js` | intermediate 文案一句 |
| agent-log / todo | 同步 |

## Task 1：特征化（先红） ✅

**文件：** `scripts/characterization/characterize-menu-scan.mjs`

新增用例：

1. 父模块下仅有 `intermediate=1` 同名叶 → scanned L2 同名 → `updates` 含该 id，`creates` 无该名  
2. intermediate 名「产品信息管理」，扫描「产品阶段管理」→ 不升格 intermediate，走 create  
3. 已有可导航同名 → 仍更新可导航，不碰 intermediate

```bash
node scripts/characterization/characterize-menu-scan.mjs
```

预期：新用例先 FAIL（当前跳过 intermediate）。

## Task 2：buildScanApplyPlan 升格匹配 ✅

**文件：** `src/services/menu-scan-service.js`

在 L2 分支：`navKids` 匹配失败后：

```js
const interByName = kids.find(
  (c) => Number(c.intermediateFlag) === 1 && String(c.name || '').trim() === name,
);
if (interByName) {
  updates.push({ nodeId: interByName.id, menuXpath: xpath, sortOrder, promote: true });
  matched += 1;
  continue;
}
```

**验收：** Task 1 用例变绿。

## Task 3：applyScanPlan 落库升格 ✅

**文件：** `src/services/menu-scan-apply.js`（+ session 的 `loadExistingModules`）

- updates：若 `u.promote`（或目标当前 intermediate=1）→ 额外写 `intermediateFlag: 0`、`unmatchedFlag: 0`；**不写** source / umlEcd  
- 确认 children **包含** intermediate，否则 plan 看不到 id=7  

**验收：** characterize 全绿。

## Task 4：存量孪生清理 ✅

**文件：** `scripts/maintenance/merge-intermediate-ai-twins.mjs`

指定 `--systemId=1 --apply`：同模块同名 inter+nav → 迁 traj → 合 xpath/pageId → 删 nav → 升格 inter。

```bash
node scripts/maintenance/merge-intermediate-ai-twins.mjs --systemId=1 --apply
```

**验收：** 对公客户管理仅 `7`，`source=json_import`，xpath 非空，traj 仍 21。

## Task 5：文档 / 可选再扫 / 收工 ✅

- [x] api-docs intermediate 说明  
- [ ] 正式 `1` 可选再 scan 确认无新孪生（跳过，非阻塞）  
- [x] todo 勾选（agent-log 收工由 controller）  

```bash
node scripts/characterization/characterize-menu-scan.mjs
node scripts/characterization/characterize-menu-scan-uml-adopt.mjs
```

## 禁令

- 不改 source 为新枚举  
- 不异名改名升格 intermediate  
- 不推送伙伴（下周一）  
