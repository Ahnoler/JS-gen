# Design: 产品要素库原子交易重切与湿测

**日期**：2026-09-08  
**状态**：已批准（用户确认 B + 仅参考 #61/#66/#503）  
**对齐**：[`2026-09-07-req-to-draft-traj-design.md`](2026-09-07-req-to-draft-traj-design.md)；KB [`product_element.json`](../../../data/kb/flows/product_element.json)

## 1. 目标

以遗留交易 **#61 / #66 / #503** 为只读参考，将「产品要素库」整页 CRUD 重切为 **原子草稿交易**，再 **串行湿测录制**（prepare → record/start → detach）。

成功终点：

1. ≥4 条 draft/recorded 轨迹挂载 `functionId=9000000468`，粒度单闭环；
2. 每条含可核对 stamp / toast / 树或列表证据；
3. 旧 #61/#66/#503 **不改不删**。

## 2. 范围

### In

- 挂载：`functionId=9000000468`（产品要素库叶子）；`systemAccountId=2`
- 原子 T1–T4（必录）；T5 删除可选后置
- 出处：`data/kb/req/product-mgmt/chapters/02-产品要素管理.md`（任务正文 + 能写则写 provenance 四字段）
- 证据：`tmp/product-element/`（task / through-report / session 日志）

### Out

- 产品库侧公共/个性化配置（#688/#689/#670 等）
- 自动批量录制；本轮不晋升操作组件
- 修改/删除遗留 #61/#66/#503

## 3. 参考吸收

| 源 | 吸收 | 丢弃 |
|---|---|---|
| #61 completed | 树：选根/类型 → 新增类型/组件 → 删除规则 → 右侧信息 | 五阶段捆一笔 |
| #66 draft | 组件下要素列表增删改查口径 | 与树入口混绑 |
| #503 recorded | stamp 贯通文案、进库双根、类型→组件顺序；图标 tooltip | 单笔含类型+组件；P2 图标失败路径 |

## 4. 原子清单

stamp：`20260908-elem`（名称/描述统一带此前缀）。

| ID | 名称 | 闭环 | 硬成功判据 |
|---|---|---|---|
| T1 | 进入产品要素库 | 菜单进库 | 可见「产品公共要素」「产品个性化要素」双根 |
| T2 | 新增要素类型 | 个性化侧 →【新增类型】→ 名称+序号=1 → 保存 | toast「操作成功」+ 树出现 `KB测要素类型-20260908-elem` |
| T3 | 新增要素组件 | 选 T2 类型 →【新增组件】→ 名称+序号 → 保存 | toast + 树出现 `KB测要素组件-20260908-elem` |
| T4 | 新增产品要素 | 选 T3 组件 →「产品要素」页签 →【新增】→ 远程选要素+类型 → 确定 | 列表出现所选要素 |

T5（可选）：删除无引用 stamp 叶子；有引用则断言失败提示。

## 5. 执行流程

```
参考 #61/#66/#503
    → 写 4 份 task（tmp/product-element/task-T*.md）
    → analyze → create draft（functionId=9000000468）
      或 draft-traj propose/commit + functionIdOverrides
    → 串行 T1→T2→T3→T4：prepare → start → detach
    → through-report + agent-log 收工
```

建草稿优先走现有产品 API（analyze/create）；若走 `draft-traj/commit`，必须 `functionIdOverrides` 将要素库原子指到 **0468**（propose 当前 `suggestedFunctionId` 常为 null）。

## 6. 录制护栏（#503 教训）

- 新增类型/组件：**图标 tooltip** / `click_icon_button`，禁止 `click_button('新增类型')`
- 按钮双候选：`保存`/`保 存`，`确定`/`确 定`
- 出现「天元相关配置」全局弹窗 → 停手上报，不擅自关闭
- 验收认 `stepCount>0` + 业务 stamp/toast，不认仅 `isSuccessful` / `phase_done`

## 7. 验收

| # | 标准 |
|---|---|
| 1 | T1–T4 各有独立轨迹；挂 0468 |
| 2 | T2/T3 树可见 stamp；T4 列表可见要素 |
| 3 | stderr/报告无假成功（无 QUALITY FAIL 却标成功） |
| 4 | 旧 61/66/503 仍只读存在 |

## 8. 风险与回退

- 多线 NAT → MySQL 白名单：依赖用户 `update-db-whitelist` 窗
- 图标定位再失败 → CDP 仅作补证，报告诚实写；优先修 task 文案/定位提示
- 回退：停录 detach；草稿可留 draft，不 force 覆盖遗留

## 9. 决议

- 2026-09-08：用户选 **B**；仅参考 **#61/#66/#503**；设计确认「可以，继续」
