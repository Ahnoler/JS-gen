---
name: req-doc-to-kb
description: >-
  模块级需求分册导入 KB 作业区：登记 data/kb/req/<moduleKey>、
  officecli 切片 chapters + through-chains、可选 drafts。
  禁止写 data/kb/flows、禁止 promote。
---

# 需求文档 → KB 作业区

> **批量 / Agent Team：** 见同目录 [`USAGE.md`](./USAGE.md)（语料优先级、`moduleKey` 表、Lead 派工与并行规则）。单模块仍按本文步骤执行。

## 何时使用

用户要求导入/切片某模块需求分册、建 req 作业区时。

触发示例：「导入/切片某某模块需求分册」「按需求建模块作业区」；「把 `docs/天阳信贷系统需求文档` 全部需求跑一遍」（→ 先读 USAGE.md）。
## 作业区目录树

登记成功后，模块作业区位于 `data/kb/req/<moduleKey>/`：

```
data/kb/req/<moduleKey>/
├── manifest.json          # 模块元数据与 status
├── source.link.json       # 源文档路径登记
├── chapters/              # 视图1：章节保真（Agent 填）
│   └── *.md
├── through-chains.md      # 视图2：可贯通主链清单
├── wet-test.md            # 视图3：逐叶湿测证据表（湿测阶段填；模板见下文）
└── drafts/                # 可选：流程卡草稿（非正式 flows/）
    └── *.json
```

- `moduleKey`：`^[a-z0-9]+(-[a-z0-9]+)*$`（如 `product-mgmt`）；中文名写在 manifest。
- `manifest.status` 枚举：`registered` | `sliced` | `drafted`（见下文状态流转）。

## 步骤

1. **登记作业区** — `POST /api/v2/kb/req-modules`（或按契约手建目录）。Body：`moduleKey`、`moduleName`、`sourcePath`、可选 `note`。API 不可用时手建目录并注明。
2. **读源** — officecli 读 `sourcePath`；剥 `RQM_META` 噪声；不改源文件。
3. **视图1：章节保真** — 填 `chapters/`：按文档目录拆章；含标题路径、ZJJK（若有）、要点摘要；文档口径与 SUT 差异单列「待湿测」。**强制契约**：
   - 每章末尾必须有**机器可解析的 ZJJK 清单行**，格式 `ZJJK编号（页面名）`、顿号分隔——湿测阶段据此机械提取叶节点清单；
   - 已知 **FS 场景号 / 路由名**（`fcnScnEcd` / `avyEcd`）必须随章记录——湿测与引擎导航的最硬定位证据；
   - 按钮/字段文案写明是**文档口径**（SUT 实际文案可能漂移，如文档「提交流程」vs SUT「流程提交」），不要把文档措辞当成 SUT 事实。
4. **视图2：主链清单** — 写 `through-chains.md`：候选主链（闭环目标、步骤、前置、章节出处）；旁路/Out 单列；可建议挂载叶子/functionId。
5. **可选草稿** — 仅当用户明示「出草稿卡」时写 `drafts/*.json`（`draftFrom: "req"`、`moduleKey`、`sourceRefs`；schema 同正式 flows）。**湿测门槛（2026-09-05 用户拍板）**：草稿卡只允许引用 `wet-test.md` 判定为 `match` 的叶节点；`drift` 叶须先回填 chapters（以 SUT 实测为准）再出卡；`blocked`/`not-found` 叶禁止出卡。
6. **收工** — 更新 `manifest.status` → `sliced` 或 `drafted`；列章节数、主链条数、草稿数、建议下一湿测主链；收工汇报。

### 状态流转

| status | 含义 |
|--------|------|
| `registered` | 已登记作业区，尚未切片 |
| `sliced` | 已完成 chapters + through-chains |
| `drafted` | 在 sliced 基础上已写 drafts |

> 湿测进度**不进** status 枚举（避免动 characterization pin）：以 `wet-test.md` 存在性及其中 pending 计数为准。

## 湿测（视图3：逐叶真机验证）

> 2026-09-05 用户拍板方针：**逐模块、逐叶节点**跑真机湿测；湿测铁证是出 drafts / promote 的门槛。切片（sliced）完成 ≠ 作业区终态。

### 清单建立

从 `chapters/` 各章末尾的 ZJJK 清单行 + `through-chains.md` 提取该模块全部叶节点，按主链分组建 `wet-test.md` 判定表（初始全部 `pending`）。每行：`# | ZJJK | 页面名 | 菜单路径（文档口径） | 判定 | 差异/证据`。

### 判定词表（每行必含日期）

| 判定 | 含义 | 要求 |
|------|------|------|
| `match` | 与文档一致 | 写关键实证（字段/按钮/列名清单或与文档差异为空） |
| `drift` | 有差异 | 写明差异类别与明细（见下「drift 分类学」） |
| `blocked` | 数据/权限条件不足 | **写补测条件**（如「待有在途审批流程」）；拦截类必须留后端异常原文（BizException 全文）——这是业务规则的最高等级证据 |
| `not-found` | 菜单/页面在 SUT 不存在 | 写导航尝试路径 |

### 写操作黑名单（共享测试系统安全约束）

湿测**只读验证**：允许打开向导/弹窗、切换步骤、展开折叠区、查询列表；**禁止**一切业务落库动作——确认、提交、保存、作废、删除、撤销、审批同意等一律不点。走到最终确认前一步即止，截图存证后关闭。

### drift 分类学与回流（湿测铁证 > 需求原文）

| 类别 | 例（2026-09-05 credit-corp 实测） | 去向 |
|------|------|------|
| wording 措辞 | SUT「流程提交」≠ 文档「提交流程」 | 回填 chapters，标注「SUT 实测」 |
| behavior 行为 | 主页列表默认不自动加载；放大镜无条件查询返回 search false | 回填 chapters **并**沉淀引擎提示词 cue / KB 卡规则字段（自动化致命坑） |
| validation 校验 | 作废前置=批复下无关联在途/生效用信合同 | KB 卡前置条件字段；后端异常原文留在 wet-test.md |
| structure 结构 | 查看批复页左侧子导航 ≠ 文档「标签页」 | 回填 chapters |
| api-contract 接口 | 报文字段缺失/口径矛盾 | chapters「待湿测」升级为引擎 cue |

回填 chapters 时**以 SUT 实测为准**，保留原需求口径并标注两源（不得用需求原文覆盖湿测铁证）。

### 执行规则

- **串行**：共享浏览器，模块间也不并行；一次一个模块、一个 SUT 登录窗口（SUT 会话约 50 分钟过期——正好一模块一窗口的节奏）。
- 操作纪律：Playwright MCP `snapshot → click`；Element UI 真点（自带 mousedown）；固定列表格遮挡时优先点行内单元格/固定列内元素。
- 证据：截图存 `tmp/kb-wet-test/<moduleKey>/`（tmp 短寿命，**文字证据为准**，截图路径仅作辅助索引）。

## 禁区

- **禁止**写 `data/kb/flows/**`
- **禁止**调用 `promote.py` / **禁止**写 `staging`
- **禁止**一次多模块；**禁止**做手册/接口/案例/计划导入（见 spec §3.1）
- 不改 `_kb.py` / `promote.py` / 正式 `flows/` / `staged_flows.jsonl`（除非另开任务且声明）
- 不以需求原文覆盖湿测铁证

## 检查清单

- [ ] manifest 字段齐全（moduleKey、中文名、源路径、时间、status）
- [ ] chapters 非空或显式说明失败原因
- [ ] 每章末尾 ZJJK 清单行机器可解析（湿测/出卡依赖此接口）
- [ ] through-chains 有候选或「无闭环主链」
- [ ] （湿测已开展时）wet-test.md 判定表齐全：无 pending；drift 已分类；blocked 含补测条件与异常原文；写操作零落库
- [ ] 未触碰正式 flows
- [ ] 未调用 promote / 未写 staging
