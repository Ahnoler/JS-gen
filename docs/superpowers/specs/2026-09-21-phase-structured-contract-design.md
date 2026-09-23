# 阶段结构元数据（方案 D · 第 2 刀）设计

> **状态**：草案，待审。未开工实现。
> **切片**：持久化阶段合约，并在字段有效时让执行机直接使用；运行时文本分类只在缺失或无效时兜底。
> **前置**：方案 C 已落地（`be21aafd`，合并 `5639541c`），流程见 `docs/superpowers/specs/2026-09-21-phase-contract-token-ownership-design.md`。
> **不做**：核验型阶段主收口（`verify-phase-token` 第二步，仍等湿测窗口零误报后再点单）。

---

## 1. 问题

`trajectory_phase` 只存 `description` 文本。录制每个阶段时，执行机用这段文本重跑 `compile_boundary` / `compile_phase_intent`（LLM reviewer 在场时仍把规则编译结果当作 `boundary_override`）。措辞或拆分稍有差异，就会签出本阶段产不出的终态令牌；`done` 门禁只读这次签下的 `_phase_boundary`，不会重签，错误被放大成绕圈。

方案 C 把「终态令牌归执行终态动作的阶段」写进了编译器。合同仍在录制当场、按单条描述重签，分析阶段已经做完的拆分判断没有被记住。

## 2. 目标

分析拆阶段时，与 `description` 一起产出一份结构化合约，写入 `trajectory_phase`。录制下发时原样带上。执行机看到**有效**合约时：

- 把它写成 `_phase_intent` 与 `_phase_boundary`（同一次写入，门禁仍只读 boundary）；
- **不**调用 `compile_boundary`、`compile_phase_intent`、`review_phase_contract`，也**不**跑 `_apply_cross_phase_token_guard`。

合约缺失、解析失败或字段不在允许集内时，整段丢弃，走今天的 reviewer + 文本分类路径，行为与现在一致。

历史轨迹与手工只写描述的阶段没有合约，自动落在兜底路径上。不回填旧行。

## 3. 非目标

- 不改 `phase_done_ok` 的通过/失败语义，不改令牌种类，不改方案 C 的分支优先级。
- 不实现核验型阶段判定式，不启用 `mode=verify`。
- 不把运行时编译器搬到 Node，也不在录制前用同一套文本规则「预编译再存」——那样签合同的仍是措辞，只是签得更早。
- 不提供单独的合约编辑 UI。用户改写阶段描述时，已存合约作废（见 §6）。
- 不改回放对已录步骤的解释。本切片只影响**新录制**阶段开始时如何签合同。

## 4. 合约形状（v1）

存在 `trajectory_phase.contract_json`（可空 JSON）。有效文档：

```json
{
  "v": 1,
  "mode": "navigate",
  "refill": "none",
  "submitRequired": false,
  "successWhen": ["url_change", "page_opened"],
  "source": "analyze"
}
```

| 字段 | 允许值 |
|---|---|
| `v` | 仅 `1`。其它版本视为无效。 |
| `mode` | `login` · `query` · `navigate` · `create` · `modify` · `introduce_pick` · `other` |
| `refill` | `none` · `all_editable`。`all_editable` 仅允许 `mode` 为 `create` 或 `modify`，否则无效。 |
| `submitRequired` | 布尔。`true` 仅允许 `mode` 为 `create`、`modify`、`introduce_pick`，否则无效。 |
| `successWhen` | 字符串数组，可空。每个元素必须属于：`toast_ok` `url_change` `saved_navigation` `query_clicked` `page_opened` `nav_next_clicked` `picker_closed` `confirm_click` `dialog_confirmed` `introduced_backfilled`。重复项去掉，顺序保留。 |
| `source` | 仅 `analyze`。执行机写入 store 时改记为 `persisted`，便于和 `rules_fallback` / `llm` 区分。 |

任一字段违规 → 整份合约无效，该阶段 `contract_json` 存 `NULL`（描述照常落库）。不因为一份坏合约让整次分析失败。

`submitRequired` / `successWhen` 用扁平字段入库，是为了让分析模型少嵌套。执行机应用时收成现有合同字典：

- `submit = { required: submitRequired, via: submitRequired ? (mode==introduce_pick ? 'any' : 'click_save') : 'any', button_text: '' }`
- `success = { kinds: successWhen, evidence: [] }`
- `refill` 原样

`button_text` 留空：恢复处方继续用现有 mode 默认文案（创建「保存」、修改「确认」、引入「确认」），不从分析文本再猜按钮名。

## 5. 谁来签

生产者是 `analyzeRequirementToPhases` 的同一次拆分，不是录制时的规则编译器。模型在看到全部阶段的前提下为每段给出合约，跨阶段归属在这时决定。

提示词在现有规则 3.2 / 3.3 与示例 7 / 8 之后，增加输出字段说明（不改规则 1–10、3.1 的拆分主体）：

- 每个阶段除描述字符串外，给出 `mode`、`refill`、`submitRequired`、`successWhen`。
- 对照与方案 C 令牌表一致，写进提示词供模型照抄，不在 Node 里再编译一遍：
  - 仅打开选择器/弹窗/页面 → `navigate`，`submitRequired=false`，`successWhen=["url_change","page_opened"]`，`refill=none`
  - 纯填写/选择且保存在后续阶段 → `create` 或 `modify`，`refill=all_editable`，`submitRequired=false`，`successWhen=[]`
  - 本阶段确有保存/确认 → `create` 或 `modify`，`refill=all_editable`，`submitRequired=true`，`successWhen=["toast_ok","url_change"]`
  - 查询 → `query`，`successWhen=["query_clicked"]`
  - 引入并在本阶段确认/回填 → `introduce_pick`，`submitRequired=true`，`successWhen` 取 `picker_closed` / `confirm_click` / `dialog_confirmed` / `introduced_backfilled` 中模型点名的子集，至少一个
  - 登录 → `login`，`successWhen=[]`
  - 其余 → `other`，`successWhen=[]`，`refill=none`，`submitRequired=false`

模型输出从「`phases` 字符串数组」改为对象数组。解析器**两种都接受**：

- 字符串元素：与今天相同，合约记 `null`。
- 对象元素：`description`（必填）+ 上述字段。描述为空则丢弃该阶段。

对外分析响应保持兼容：

```json
{
  "phases": ["…描述…"],
  "phaseContracts": [ { "v": 1, "mode": "navigate", "…": "…" }, null ]
}
```

`phases` 仍是字符串数组，与 `phaseContracts` 等长。`null` 表示该段走录制兜底。现有只读 `phases` 的调用方（草稿提交、前端）不用改解析。`createTransactionWithPhases` 增加可选 `phaseContracts`，与 `phases` 按下标对齐；缺省或长度不符时，多出来的阶段合约为 `null`，不报错。

## 6. 落库与失效

迁移：`trajectory_phase.contract_json JSON NULL`。`schemas/init.sql` 同步。无回填。

写入点：`trajectoryPhaseDao.create` 在创建轨迹阶段时带上校验后的对象；校验失败写 `NULL`。

失效：凡把该行 `description` **改成不同文本**的更新（`upsertPhaseDescription`、按描述同步覆盖）把 `contract_json` 置 `NULL`。描述未变则保留。这样改措辞不会留下按旧措辞签的合同。重新分析并创建新轨迹才会再次带上合约。

只改状态、完成时间、done log 的更新不动 `contract_json`。

## 7. 录制透传

`trajectory-recording-runner.js` 组 `stepData` 时，若该行 `contract_json` 解析为 §4 的有效文档，设置 `stepData.phase_contract`。无效或空则**省略字段**，不要传 `{}`。

`instruction` 仍是 `phase.description`。业务数据注入、特殊元素候选、`all_phases` 文本目录保持原样。兜底路径继续靠这些文本。

## 8. 执行机应用

`scripts/agent/service.py` 在 heal 模式之外、调用 reviewer 之前：

1. 读取 `instruction.phase_contract`（兼容 `phaseContract`）。
2. 用与 §4 相同的允许集再验一次（Node 与 Python 各有一份纯函数，故意不共享进程；允许集以本设计为准，pin 两侧各钉一条非法样例）。
3. 有效则调用新函数 `apply_persisted_phase_contract(store, contract, all_phases, current_phase_number)`：
   - 收成现有合同字典，`source='persisted'`；
   - `apply_phase_contract(..., boundary_override=None)` 的既有「由合同生成 boundary」分支会跑跨阶段守卫，**不能直接用**；
   - 因此本函数自己写入 `_phase_intent`、`_phase_boundary`、`_task_mode`、锁旗标，`boundary.source='persisted'`，`success_when` 等于 `successWhen`，`role` 按现有 `_MODE_TO_ROLE` 映射；
   - 不调用 `compile_boundary`、`compile_phase_intent`、`review_phase_contract`、`_apply_cross_phase_token_guard`。
4. 无效或缺失：保持今天的 `review_phase_contract` → `compile_boundary` → `apply_phase_contract`，失败再 `apply_phase_intent`。

heal 模式优先：`heal_mode` 为真时忽略 `phase_contract`，与现在一样不签阶段意图。

跨阶段守卫不跑的原因：守卫靠后续阶段的**描述文本**改写令牌。持久化合约已经在分析时看过全目录。再按文本改写会把「直接使用」退回措辞敏感。守卫仍完整保留在兜底路径。

日志一行：`phase_contract=persisted mode=… submit=… success_when=…`。兜底路径日志不变。

## 9. 行为对照

| 输入 | 结果 |
|---|---|
| 有效 `navigate` 合约，描述文本含「引入」「确认」 | 合同保持 `navigate`，不索要 `picker_closed` |
| 有效纯填写合约（`create` + `submitRequired=false` + `successWhen=[]`） | `done` 不索要 `toast_ok`；恢复处方不推荐 `click_save` |
| `contract_json` 为 `NULL` | 与今天相同：reviewer，否则规则编译 |
| `mode:"verify"` 或未知令牌 | 当无效，走兜底 |
| 用户把描述改成另一句 | `contract_json` 清空，下次录制走兜底 |
| 旧轨迹 | 列为空，走兜底 |

## 10. 验收

新增 pin，并登记 `scripts/refactor/verify-all.sh`（phase 域；拿不准的断言同时进 core）：

- Python：`characterize-persisted-phase-contract.py`
  - 有效 navigate 快照 + 易被判成引入的描述 → store 中 mode/success_when 等于快照，且该调用栈未进入 `compile_boundary`（用源码针 + 运行断言：`boundary.source=='persisted'`）。
  - 缺失与非法 `mode` → 仍走到现有 `apply_phase_intent` / reviewer 路径（用现有测试替身或直接对分发函数断言返回 source 不是 `persisted`）。
  - heal 模式忽略快照。
- Node：扩 `characterize-trajectory.mjs`（或同域新文件，若该文件已被钉死函数名清单则新开，避免改坏既有针）
  - `parseAnalyzePayload` 接受字符串数组与对象数组；对象缺 `description` 丢弃；非法 `mode` 得到 `phases[i]` 保留、`phaseContracts[i]===null`。
  - 描述更新函数在文本变化时把合约置空（对纯函数或 dao 更新语句做源码针 + 单测能覆盖的部分）。

不新增湿测门禁。真机是否少签错令牌，由后续合约线录制观察 `phase_contract=persisted` 日志，不阻塞本切片合并。

## 11. 改动落点

| 文件 | 改动 |
|---|---|
| `migrations/` 新迁移 + `schemas/init.sql` | 可空 `contract_json` |
| `src/dao/trajectory-phase-dao.js` | create/读出 camelCase `contractJson` |
| `src/services/trajectory/trajectory-meta-service.js` | 提示词、解析、`phaseContracts`、创建时写入 |
| `src/services/trajectory/trajectory-phase-service.js` | 描述变更清空合约 |
| `src/services/trajectory/trajectory-recording-runner.js` | `stepData.phase_contract` |
| `src/dashboard/api-docs/groups/trajectory.js` | 分析响应与阶段字段补一句可选 `phaseContracts` / `contractJson` |
| `scripts/controller/actions/phase/intent_contract.py` | `apply_persisted_phase_contract` + 允许集校验 |
| `scripts/agent/service.py` | 有效快照走持久化应用，否则原路径 |
| 新 pin + `verify-all.sh` | §10 |

`scripts/prompts/phase-reviewer-prompt.md` 不改。兜底路径的 reviewer 规则保持现状。

## 12. 实施顺序

引擎线 E1–E4（`engine/replay-cancel-20260921`）的文件集包含 `scripts/agent/service.py`。本切片也要改这个文件。**E1–E4 合入 `uara_V2.0` 之前不改 `service.py`**。设计冻结后可以先做迁移、dao、分析解析与 pin 里不碰 `service.py` 的部分；执行机接线留到 E1–E4 收工后的同一分支续上，避免两支同时改 `service.py`。

控制面改动（分析、落库、runner 透传）需要重启 4097 后，新的分析与录制才带上 `phase_contract`。Python 侧随新录制子进程加载。合并前按仓库约定走合并后全量 `verify-all.sh`。重启窗口单独请示，不在本设计里默认执行。

## 13. 风险

- 分析模型签错合约时，录制不再用规则或 reviewer 纠正。缓解：允许集拒绝非法值；描述一改合约即废；日志带 `persisted`，错单可以清 `contract_json` 后重录以走兜底。
- 提示词变长，拆分质量可能波动。缓解：`phases` 字符串契约不变；对象解析失败退回「只有描述」。用现有示例 7 / 8 加两条带合约的期望做解析单测，不把模型活输出钉进 pin。
- 两侧允许集漂移。缓解：本文件 §4 是唯一清单；Python 与 Node 的 pin 各包含一条「未知 mode / 未知令牌 → 无效」。
