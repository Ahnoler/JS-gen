# KB Value A/B 实验报告（正式 12×2）

- 线：KB 价值 A/B（方向 2）；spec：`docs/superpowers/specs/2026-09-11-kb-value-ab-design.md`；plan：`docs/superpowers/plans/2026-09-11-kb-value-ab.md`
- manifest：`scripts/kb/kb-ab-manifest.v1.json`（v1.1，frozenAt 2026-09-11T03:40+08:00）
- 跑批证据：`tmp/kb-ab/runlog.jsonl`（25 行 / 24 条轨迹 727–750，727 双 attempt）、`tmp/kb-ab/cleanup-ledger.jsonl`
- 收数引擎：`scripts/kb/kb-ab-eval.mjs`（`--json`，连跑两次逐位一致，`tmp/kb-ab/eval-final.json`）
- 协议门禁：`scripts/characterization/characterize-kb-ab.mjs`（GREEN；证伪×2 见 §7）
- 提交链：`e6abfdc2`/`51374183`（spec/plan）→ `ea5d04c9`（manifest v1.1）→ `cf1751e6`（T2 证据+T3 引擎）→ `c1ef3ad7`/`5af3ab23`/`e82bad07`

## 1. 结论（三类口径，spec §先验功效）

> **③ 证据不足。**
> A 臂 5/12（41.7%），B 臂 6/12（50.0%），差值 +8.3pp。n=12/臂时先验功效只够检出 ≥30pp 的差异（20pp 级需 n≥40/臂），+8.3pp 落在噪声区间内，两臂 Wilson 95% CI 大面积重叠（A [0.193, 0.680]，B [0.254, 0.746]）。**不得据此宣称"前置流程卡模板有效"或"无效"——两者都不成立。** 若未来要把 ±20pp 级差异下成结论，需要 n≥40/臂（80 次录制）；若只验证"大效应存在"（≥30pp），本轮规模可复用。

## 2. 原始逐 run 表（P1=record_status 口径，spec §3 冻结）

| 轨迹 | 臂 | 需求 | 卡 | P1 | 步数 | 墙钟(实测 s) | 一句话归因 |
|---|---|---|---|---|---|---|---|
| 727 | A | R01 评级 | rating | failed | 15 | 293 | SUT 拒绝对 3 家在途评级客户再发起评级 |
| 728 | B | R01 评级 | rating | failed | 0 | 72 | 同上（paired 同墙）；零动作 done |
| 729 | A | R02 新增客户 | customer_onboarding | failed | 27 | 420 | 步预算 23/23 耗尽；create 已成功（26091102181243755） |
| 730 | B | R02 新增客户 | customer_onboarding | **recorded** | 33 | 2143 | 卡前置给了完整链路提示，一次通过 |
| 731 | A | R04 法人引入 | customer_onboarding | **recorded** | 34 | 900 | 引入链完整跑通 |
| 732 | B | R04 法人引入 | customer_onboarding | failed | 38 | 1220 | pending_fields 联网核查状态；create+引入已成功（26091103113741958） |
| 733 | A | R05 评级 | rating | failed | 0 | — | navigate 零步异步降级（登录回放代导航） |
| 734 | B | R05 评级 | rating | **recorded** | 4 | 114 | 同形态 B 臂通过 |
| 735 | A | R06 客户查询 | customer_query | **recorded** | 5 | 188 | — |
| 736 | B | R06 客户查询 | customer_query | **recorded** | 6 | 188 | — |
| 737 | A | R07 评级查看 | rating-query-view | **recorded** | 1 | 84 | — |
| 738 | B | R07 评级查看 | rating-query-view | **recorded** | 1 | 81 | — |
| 739 | A | R09 产品查询 | product_query | failed | 7 | 365 | SUT NPE（服务端 500） |
| 740 | B | R09 产品查询 | product_query | failed | 6 | 410 | 同一 NPE（paired SUT 故障，未重试） |
| 741 | A | R11 风险分类 | risk-class-statistics | failed | 0 | — | 零步异步降级 |
| 742 | B | R11 风险分类 | risk-class-statistics | failed | 0 | — | 同上（paired） |
| 743 | A | N01 create+查询 stamp | customer_onboarding | **recorded** | 12 | 236 | 全链成功（KBAB26091102-202609110429） |
| 744 | B | N01 create+查询 stamp | customer_onboarding | failed | 12 | 207 | 质量门伪失败：reviewer kinds `url_change+toast_ok` vs 录制 token `saved_navigation`（任务本身全程成功，26091104401295560；见 §6 门伪） |
| 745 | A | N02 法人引入(显式腿) | customer_onboarding | failed | 33 | 754 | 步预算 29/29 耗尽；create+引入导入已成功（26091104553520861），差最后编辑页保存 |
| 746 | B | N02 法人引入(显式腿) | customer_onboarding | **recorded** | 39 | 747 | 同任务全链完成（26091105094428662） |
| 747 | A† | N03 双查询一致性 | customer_query | **recorded** | 9 | 192 | attempt1 因 executor 掉线无 prepare 无副作用（aborted），attempt2 通过 |
| 748 | B | N03 双查询一致性 | customer_query | **recorded** | 11 | 253 | 纯只读对（KB测客户-20260905-1315） |
| 749 | A | N04 评级发起 | rating | failed | 17 | 527 | 评级弹窗循环（候选客户全带在途评级流，同 R01 墙） |
| 750 | B | N04 评级发起 | rating | failed | 14 | 482 | 同一墙（paired SUT 状态） |

† 747 attempt1（prepare 409 无可用执行机，executor WS 1006 半开掉线而服务端节点行未清）登记于 runlog 且不计观测；attempt2 为正式观测——**非按结果剔除**（attempt1 无任何页面动作，环境阻障类 aborted，白名单理由在案）。

## 3. 每臂汇总

| 量 | A（无提示） | B（前置【流程卡模板】） |
|---|---|---|
| 成功（P1） | 5/12 = 41.7% | 6/12 = 50.0% |
| Wilson 95% CI | [19.3%, 68.0%] | [25.4%, 74.6%] |
| 差值（B−A） | +8.3pp（CI 重叠，不显著） | |
| 配对结局 | A 独赢 2 对（R04/N01）、B 独赢 3 对（R02/R05/N02）、双成 3 对、双败 4 对 | |
| 步数（成功 run 中位） | 9 | 11 |
| 步数（全部 run 均值） | 13.3 | 13.7 |
| P3 人工介入步 | 0 | 0 |
| P4 返工（error 步） | 0 | 0 |

成本解读：B 臂成功 run 中位步数略高（11 vs 9），但 B 独赢的 3 对全是"多腿任务"（R02 33 步、N02 39 步 vs A 预算耗尽失败）——卡的价值形态是**把预算内做不完的多腿链路做完**，不是省步数。单腿简单任务（R06/R07）两臂等价。

## 4. 天花板判定回顾（T0）

pilot（723–726，R02/R06）A 臂 2/2 = 1.0 ≥ 0.9 → 触发换锚规则，manifest 升 v1.1：难度锚改为 stamp 族（N01/N02）+ 法人引入（R04/N02）+ 评级族（R01/R05/N04）+ 只读一致性（N03），drop R03/R08/R10（理由在 manifest `droppedRequirements`）。判定证据与 changeLog 均已冻结在 manifest，非事后找补。

## 5. 遵循度（P5）与越界（P6）

- P3 人工介入：两臂全程 0 manual 步（全自动录制）。
- P4 返工：两臂 0 个带 error 步（失败 run 的失败体现为 missing_success_token / 预算耗尽 / SUT 拒绝，不是步级报错）。
- P5 卡遵循度（marker 路由 + 卡按钮命中率，A/B 合计）：region 32 段中 29 段命中卡 `hash_markers`（90.6%）；`click_button`/`click_element_by_index` 文案 114 次中 92 次命中卡 `nodes[].buttons`（80.7%）。两臂对称（A: 14/15 段、48/57 次；B: 15/17 段、44/57 次）——B 臂有卡但遵循度并不比 A 高，说明成功差异不来自"更贴卡地走"，而来自卡提示块对任务分解本身的引导（见 §3 成本解读）。
- P6 越界：3 个未命中卡 marker 的 region（734 的 `cpctMgtPg`、737/738 的 `rtgEnqrMgtPg`）——均为**卡 marker 词表与页面 hash 码错位**（rating-query-view 卡只带菜单码 `ZJJK00103247/ZJJK00124779`，页面 region 是路由 hash `rtgEnqrMgtPg`；734 是登录回放导航落在客户管理中转页），非越界操作。写黑名单按钮（删除/停用/注销/作废/强制/退回）两臂合计 **0 命中**。
- 24 run 全部写入带 `KBAB<runId>-` 前缀或纯只读；N03 双臂对他人 `KB测…` 数据零触碰（仅查询）。
- 残留：8 笔新建客户全为「信贷预客户」，SUT 状态机删除入口仅对草稿客户开放（09-07 R1 先例 8 次实证）→ 无法经 UI 删除，按先例留证移交（`cleanup-ledger.jsonl` 逐条带证据步号 + manifest `cleanupLog` 终局条目）。

## 6. 如实登记的干扰项

1. **744 质量门伪失败（B 臂）**：任务全程成功（create→查询 stamp 命中），但 reviewer LLM 上报的 success kinds（`url_change`+`toast_ok`）与 legacy `has_contract_success` 校验的录制 token（`saved_navigation`）不同名——legacy 路径缺 boundary 路径已有的别名归一。**红线内不改 `src/**`**，按冻结 P1 口径记 failed，门伪机制已在报告登记，属引擎侧已知 artifact（同款可致成败互换 744↔743）。
2. **零步异步降级（733/741/742）**：登录回放代导航导致业务零动作，异步质量闩把 HTTP 回读后的 `recorded` 降为 `failed`。两臂同现（733↔734 不同命是配对内随机），DB 终态为准。
3. **paired SUT 故障（739/740 NPE、749/750 评级在途墙）**：两臂同墙=有效对照，未重试（oneChance）。
4. **executor 半开掉线**：747 attempt1 prepare 409（无可用执行资源）；恢复后重跑并留痕。
5. **N01/N02 需求文本内嵌 `KBAB26091102-` 写前缀指令**：这是任务内容本身（两臂共有），非臂标记；门禁 ④ 只拦截带臂段的完整标记（`KBAB<runId>-<arm>-`）。

## 7. 门禁与证伪（plan Task 3）

- `characterize-kb-ab.mjs` 正式模式 **GREEN**：①manifest 形状冻结 ②配对完整（12/12，无同 id）③臂平衡（12/12）④无跨臂污染（name 唯一臂标记 + 纯度断言 `A.task === stripHint(B.task)` 逐字成立）⑤收数完备（24/24 可查）。
- 证伪一（臂标记互换 `--falsify-arm`）：④ 全 12 对红，verdict `FALSIFIED-AS-EXPECTED ④no-cross-arm-contamination is red`，exit 0（证伪成功）。
- 证伪二（删一条需求 `--falsify-pair`）：② 红 `missing=[R01]`，verdict `FALSIFIED-AS-EXPECTED ②pairing-complete is red`，exit 0。
- 门禁不设成功率 floor（spec §6）：成功率只进报告不作门，防 flaky 门诱发调参凑数。
- `kb-ab-eval.mjs` 确定性：`eval-final.json` 与 `eval-final2.json` `cmp` 逐位一致。

## 8. 给下一轮的可执行建议

1. **结论升级路径**：要下 ±20pp 级结论 → 扩到 n≥40/臂；建议只复用 5 个多腿锚（R02/R04/N01/N02/N04 类），砍掉两臂等价的单腿锚（R06/R07 类不提供信息量）。
2. **744 类门伪**：引擎侧修法明确（legacy `has_contract_success` 引入 boundary 的 kind 别名表），留给引擎线按 P1 排期；本线不动 `src/**`。
3. **零步降级**：navigate-only phase 的 success token 建议豁免"业务动作>0"检查（登录回放已代导航是合法形态）——同属引擎线。
4. **残留数据**：8 笔信贷预客户等 SUT 状态机放开删除或 DB 侧清理窗口（`cleanup-ledger.jsonl` 有全部 custNo）。
