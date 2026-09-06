# 设计：产品管理扁平挂载纠偏（方案 A）

> 日期：2026-09-05  
> 状态：用户认可（推送不需要「产品信息管理」路径；尽快扁平修好挂载/扫描）  
> 调研：`docs/superpowers/research/2026-09-05-product-mgmt-menu-sut-vs-db.md`

## 1. 决定

- Hierarchy 保持 **模块 → 功能** 两层；飞出层分组标题（无 url / 不可点）**不建节点**，推送 path **不带**该层。
- 不做嵌套模块、不新增 type「分组」、不引入 `groupName` 字段。

## 2. 目标数据（systemId=1 · 产品管理 `9000000002`）

| name | xpath data-id | pageId | 动作 |
|------|---------------|--------|------|
| 产品阶段管理 | RES24008 | ZJJK00095902 | **新建** type=3 |
| 核心产品映射 | RES04066 | ZJJK00095454 | **新建** type=3 |
| 产品库管理 | RES04067 | ZJJK00110131 | 保留 0740 |
| 查询产品信息 | RES04069 | ZJJK00095907 | 保留 0467 |
| 产品要素库 | RES04070 | （空） | 保留 0468 |
| 产品信息管理 `0230` | 清空错误 xpath/pageId | — | 迁轨迹后 `removed_flag=1`（保留 uml 审计） |
| 产品要素管理 `0231` | 仍无 xpath | — | `removed_flag=1` 或保持 unmatched，不挂交易 |

## 3. 轨迹迁移

仍挂 `function_id=9000000230` 的映射/阶段类（至少 #46/48/50/56/58/59/511/513）：

- 名称/已知 pageId 属映射 → 新「核心产品映射」id  
- 属阶段 → 新「产品阶段管理」id  
- 仅当原 `function_id=0230` 时 UPDATE

## 4. 扫描/导入防再发（行为约束）

1. 匹配优先级：`menu_xpath`(data-id) > `pd_cmpt_ecd` > 中文名。  
2. 已有节点占用某 data-id xpath 时，不得把另一菜单名的 xpath/pageId 写到「仅有建模名、像文件夹」的幽灵功能上而不改名。  
3. json_import 落成的无 url 文件夹名功能：扫描创建同 xpath 叶子时应 **新建正确名节点** 或 **xpath 命中后改名为 SUT 文案**，而不是保留文件夹名。  
4. 本轮若改码，范围限 `menu-scan-apply` / 相关 plan 构建；不做 DOM 三层采集大改。

## 5. 验收

- hierarchy：产品管理下可见阶段+映射两叶，xpath/pageId 与天元一致；`0230`/`0231` removed 或不挂 traj。  
- 上述 8 条 traj `function_id` 指向新叶。  
- 推送样例 path 不含「产品信息管理」。
