# 调研：产品管理菜单 SUT vs DB（2026-09-05 湿测）

> 方式：真实登录 `test.creditv5p2`（701994）+ `GET /api/v2/hierarchy/tree?systemId=1` + `_routemenu.json`  
> 目的：解释「产品阶段管理 / 核心产品映射」漏叶子、轨迹寄挂 `9000000230`、pageId 撞车。

## 1. SUT 真实树（3 层）

`localStorage` routemenu 与现场 flyout 一致：

```
产品管理 [RES000000016]                          ← L1
├─ 产品信息管理 [RES000000079]                   ← L2 文件夹（无 url）
│  ├─ 产品阶段管理 [RES24008] → /pdMgt/pdInfMgt/mntPdStg
│  ├─ 核心产品映射 [RES04066] → /pdMgt/pdInfMgt/corePdMpng
│  ├─ 产品库管理   [RES04067] → /pdMgt/pdInfMgt/pdMgtMgtPg
│  └─ 查询产品信息 [RES04069] → /pdMgt/pdInfMgt/enqrPdInf
└─ 产品要素管理 [RES000000080]                   ← L2 文件夹
   └─ 产品要素库 [RES04070] → /pdMgt/pdElmtMgt/elmtgroupOfIndex
```

现场 DOM 要点：
- 飞出层分组标题「产品信息管理 / 产品要素管理」是 **无 `data-id` 的 DIV/分组 `li.submenu-item`**，不可当功能叶。
- 可点叶子同时存在：`li.submenu-item[data-url=…]`（无 data-id）与扁平区 `li.menu-item[data-id=RES…]`。
- `menu_scan` 只采 L1 + `li.menu-item[data-id]`，**不会**把 L2 文件夹建成节点；叶子 `parentName` 靠 routemenu `rootMap` 回填为「产品管理」（扁平到 L1 下）。

## 2. 天元读码（现场点「？」）

| 菜单文案 | data-id | 路由 | 天元页面名称 | 组件编号 |
|----------|---------|------|--------------|----------|
| 产品阶段管理 | RES24008 | mntPdStg | 维护产品阶段 | **ZJJK00095902** |
| 核心产品映射 | RES04066 | corePdMpng | 核心产品映射 | **ZJJK00095454** |
| 产品库管理 | RES04067 | pdMgtMgtPg | 产品管理管理页 | **ZJJK00110131** |
| 查询产品信息 | RES04069 | enqrPdInf | 查询产品信息 | **ZJJK00095907** |
| 产品要素库 | RES04070 | elmtgroupOfIndex | （空配置对话框） | （空） |

Tab 标题与菜单文案一致（`核心产品映射 - 天阳宏业` 等），**不存在**名为「产品信息管理」的可点功能页。

## 3. DB hierarchy（systemId=1）对照

| id | name | type | menuXpath | pdCmptEcd | source | 判读 |
|----|------|------|-----------|-----------|--------|------|
| 0002 | 产品管理 | 2 | RES000000016 | - | json_import | L1 OK |
| **0230** | **产品信息管理** | **3** | **RES04066** | **ZJJK00110131** | json_import | **三错合一**：名=L2 文件夹；xpath=核心产品映射；pageId=产品库 |
| 0740 | 产品库管理 | 3 | RES04067 | ZJJK00110131 | ai | xpath+pageId 与 SUT 产品库一致 |
| 0467 | 查询产品信息 | 3 | RES04069 | ZJJK00095907 | ai | OK |
| 0468 | 产品要素库 | 3 | RES04070 | （空） | ai | xpath OK；pageId 空与天元空配置一致 |
| 0231 | 产品要素管理 | 3 | （空） | ZJJK00094373 | json_import | 建模文件夹当功能；unmatched 残留 |

**整库缺失：**「产品阶段管理」「核心产品映射」功能节点。

仍寄挂在 `9000000230` 的轨迹（API 抽查）：#46/#48/#50/#56/#58/#59/#511/#513（阶段/映射类）；其中 #513 轨迹自带 `pageId=ZJJK00095454`（映射真码），却挂在错误 function。

## 4. 根因结论（已用活页证伪/证实）

1. **命名错位（已证实）**  
   `RES04066` 在 SUT 文案与天元均为「核心产品映射」。DB `0230` 却叫「产品信息管理」并占用该 xpath → 扫描按 xpath/名无法再单独创建「核心产品映射」。

2. **pageId 串味（已证实）**  
   `0230.pdCmptEcd=ZJJK00110131` 是 **产品库** 的组件号；映射真码是 `ZJJK00095454`。与 `0740` 撞车，放大错误挂载。

3. **「产品信息管理」本不应是 type=3 功能**  
   SUT / routemenu 中它是 **无 url 的 L2 文件夹**。JSON 建模把它落成可挂载功能叶，是结构层错误。

4. **「产品阶段管理」漏建**  
   现场菜单与 `RES24008` 存在且可打开（pageId `ZJJK00095902`）。DB 无对应节点 → 阶段轨迹只能寄挂在错误的 `0230`。漏建原因候选（待改码前再钉）：扫描未覆盖 / apply 被错位 0230 吞并 / 角色菜单时序；**不是**「SUT 没有该菜单」。

5. **menu_scan 两层模型 vs SUT 三层**  
   扫描把 L3 叶子扁平挂到 L1「产品管理」下，与现场视觉分组不一致，但不直接解释「映射被叫成产品信息管理」——那是 json_import 名 + 错误 xpath/pageId 绑定。

## 5. 修复方向（调研建议，本笔记不改码）

1. 拆/纠 `0230`：去掉对 `RES04066` / `ZJJK00110131` 的错误占用；文件夹要么降为 type=2 中间层，要么删除后按需重建。  
2. 新建功能：`核心产品映射`(RES04066, ZJJK00095454)、`产品阶段管理`(RES24008, ZJJK00095902)。  
3. 把 #46/48/50/56/58/59/511/513 等按 pageId/路由迁到正确 functionId。  
4. 中长期：扫描/导入匹配优先 **data-id / pageId**，名称冲突时以 SUT 文案校正 json_import 名；考虑 L2 文件夹节点。

## 6. 证据锚点

- 浏览器湿测：2026-09-05，账号 701994，页面标题与天元对话框全文见上表。  
- API：`/api/v2/hierarchy/tree?systemId=1`、`/api/v2/system-mgmt/nodes/9000000230`、trajectories 46/48/50/56/58/59/511/513。  
- 旁证：`tmp/k6_notes/_routemenu.json` 产品管理子树。
