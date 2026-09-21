# Agent Loop × 知识库结合度调研 + UI 资产库归属评估

- 日期：2026-09-01
- 输入：logs/log.txt（一次真实 Agent Loop 录制全链日志）、K3 调研（tmp/k3_notes.md）、K4 调研（tmp/k4_notes.md）
- 结论速览：**KB 与当前 Agent Loop 基本未结合**（纯被动注册，实跑 0 次召回）；8 个注入机会点中 Top3 明确；**特殊元素UI库不可归入 KB（执行型资产，保持独立互通）、原子组件库冻结延后裁决**（分析型资产，零消费且信息可由轨迹重算）。

## 一、Agent Loop 的知识流入点全景（一次 phase 全链）

| 流入点 | 位置 | 现状 |
|---|---|---|
| System prompt | agent_utils.py:128（agent/service.py:462 调用） | agent-core + tools-common + 按 mode 加 pack；**KB 仅 cue 一小节** |
| Phase preamble | agent/service.py:300 | 阶段目录/上阶段结果，无 KB |
| 业务数据 hint | agent/service.py:389-397 → _business_data.py:118 | 纯文本拼接，不查码表 |
| 特殊元素 hint | agent/service.py:405-414 | 控制面下发候选（本轮 0 条） |
| scenario_describer | recorder.py:69-70 → _scenario_describer.py:265 | 只用 done+ACTION_LOG+快照，无 KB |
| 强制 cue（submit-ready/empty-act/重复失败） | recorder.py:62-133、recorder_emitters.py | 文案硬编码 |
| 回流侧（memory/轨迹） | recorder_emitters.py:185/675、trajectory_store.py | 不写 KB |

## 二、KB 结合度现状：基本未结合

六个 kb_* 动作已注册（_kb.py）+ 提示词 cue 一小节 = **纯被动拉取**。实测（logs/log.txt，10 步真实录制）：**LLM 全程 0 次 kb_* 调用**。逐点核实：prepare 不召回 kb_flow、business_data 不查码表、auto-fill 不查规则、scenario_describer/cue 不消费 KB、recorder 不回流 KB——全部为「否」。

## 三、日志反证（有 KB 就不会走的弯路）

1. step4 `click_adjacent_button 法定代表人/负责人名 → disabled-no-adjacent-button` 退化盲点 index=73——kb_flow 的「法定代表人引入」条目（特殊元素库 tag=4 正是它）可直接指路
2. auto-fill 把 成立日期/注册登记日期 填 2016-08-31——kb_rule 营业日期规则可前置校验
3. `select_option 国别 = first` 兜底——kb_dict 码表可给语义正确值
4. 级联轮空扫两次（cascade new=0）——kb_field 依赖组可预判
5. scenario 摘要全是操作流水，无闸门/前置知识

## 四、改善点清单（投入产出排序）

1. **phase 开始自动注入 kb_flow**（最高 ROI）：落点 agent/service.py preamble 组装后（:299-307），按阶段任务关键词 find_flow，命中即附卡片摘要（≤800 字：闸门/状态×动作/字段依赖）；复用现成 fact_pack 的 flag 门控模式（agent/service.py:310-325）；miss 静默。A/B 已证召回增益（err 3→0），但那依赖 LLM 自觉——本条把它变成必然。
2. **业务数据 hint × 码表预检**：落点 agent/service.py:389-397，select 类值注入前本地匹配候选（零 token）。
3. **强制 cue 附 kb_rule 命中**：落点 recorder.py on_step_start cue 构造。
4. **scenario_describer 加 KB 段**：读 phase 缓存的 flow 卡。
5. **特殊元素空候选 KB 兜底**：agent/service.py:154-170。
6. **recorder→KB staging 回流闭环**：done 接受后写 KB staging（半自动晋升为流程卡，防污染不自动写）。
7. 提示词触发强化 + auto-fill 兜底前查 kb_rule/kb_dict。

## 五、UI 资产库评估

| | 操作步骤原子组件库 | 特殊元素UI库 |
|---|---|---|
| 本质 | **分析型资产**：phase 步骤签名聚类（steps_json+sha256 签名+occurrence/confidence） | **执行型资产**：可回放的操作组（special_element + special_element_step，element_json 可重放） |
| 生产 | 双路：mine 自动挖掘（≥2 次出现+LLM 命名）+ 人工 | 半自动：from-trajectory 圈选 + 人工 |
| 消费 | **零消费**（仅 API 列表/详情；Phase 2 参数化全是预留字段）；现量 19 条（8 draft/8 deprecated） | **完整活闭环**：phase 候选注入 → use_special_element 嵌套重放 → 步骤回写轨迹 |
| 与 KB 重叠 | L3 高（=轨迹序列的组件化视图，KB L3 设计本就复用 trajectory） | L5 中（与流程卡平行描述登录/引入，但它带可执行步骤） |

### 裁决：B —— 部分归入 + 部分独立互通

1. **特殊元素UI库：不可归入 KB，保持独立 + 与 L5 互通**。它是执行型资产（DB 保真的 element_json/开关/候选注入管线/嵌套 replay），流程卡是描述性知识——文件化归入等于重写整条重放链路，成本 >> 收益。正确姿势：**流程卡节点引用 special_element_id**（知识指挥执行），kb_flow 召回附带候选 id。
2. **原子组件库：冻结扩展、延后裁决**。零消费者、信息可由 trajectory+确定性签名随时重算——现在迁入是为 19 条 draft 写一次性迁移器（无意义），废弃也无收益。等 KB L3（kb_seq）落地后实测重叠再定去留。
3. **防双轨过期规矩**：流程卡凡涉可执行操作组一律引用 id 不复述步骤；复用特殊元素已有的 embedding_status=stale 失效链路，加一条失效联动 hook（特殊元素更新 → 标 stale 流程卡）。

## 六、实施批次建议（下一轮）

| 批次 | 内容 |
|---|---|
| KB-I1 | phase 开始自动注入 kb_flow（preamble + fact_pack 门控模式） |
| KB-I2 | 业务数据 hint × 码表预检 + auto-fill 兜底前查规则 |
| KB-I3 | 流程卡引用 special_element_id + 失效联动 hook |
| KB-I4 | recorder→KB staging 回流 + scenario_describer KB 段 |
