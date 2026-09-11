# KB 价值 A/B（方向 2）— G1/G2/G3 结论（reviewer）

> 日期：2026-09-11 · 审查者：DSH reviewer
> 被审区间：**`ea5d04c9..dcfe1063`**（**8 笔**；交付自报的提交链漏了 `433ca3de`）
> 规格/计划：[`specs/2026-09-11-kb-value-ab-design.md`](../specs/2026-09-11-kb-value-ab-design.md) · [`plans/2026-09-11-kb-value-ab.md`](../plans/2026-09-11-kb-value-ab.md)
> 报告：[`reports/2026-09-11-kb-ab-report.md`](2026-09-11-kb-ab-report.md)
> **总判定：PASS（结论③「证据不足」成立，且被我的配对检验进一步加强）；3 项必改（证据一致性 / 样本登记 / 解释句）+ 2 项轻。**

## 1. Reviewer Checklist 五项

| # | 检查 | 我的复核 | 判 |
|---|---|---|---|
| 1 | **纯度** | **我从库直查 24 条（727–750）自行剥离提示块**：`A.task` 与 `B.task` 去掉 `【流程卡模板】…【/流程卡模板】` 后 **12/12 对逐字相同**（长度也逐对相等）；A 臂 task **0 条**含提示标记、B 臂 **12/12** 含；**task 中臂标记（`KBAB<runId>-[AB]-`）0 命中**，臂标记只在 `name` ✓。N01/N02 的 `KBAB26091102-` 确为需求文本内的写前缀指令（两臂共存），不构成污染 ✓ | **PASS** |
| 2 | **收数独立复算** | ① 引擎连跑两次 **byte-identical**，且与冻结 `eval-final.json`、`eval-final2.json` **双双一致**；② 我**不看引擎**、直接从库按 id 重数 P1：A **5/12**、B **6/12** ✓；③ Wilson CI 我独立算：A **[0.193, 0.680]**、B **[0.254, 0.746]**——与报告**逐位相同**；④ 配对结局我独立分类：A 独赢 **2**（R04/N01）、B 独赢 **3**（R02/R05/N02）、双成 **3**、双败 **4** ✓ | **PASS** |
| 3 | **样本完整性** | runlog 有 `attempt/retryOf/excludedFromStats`；**727 attempt1 在 runlog 有行且 `excludedFromStats:true` ✓**；但交付声称"两条 aborted 都登记在 `manifest.abortedRuns`"**不成立**，且 **747 attempt1 没有任何独立记录**（详见 F2） | **部分** |
| 4 | **清理** | 账本 8 条正式批客户记录齐备，`custNo` 经 backfill/correction 后**8/8 齐全**（含 746 的 17 位纠正）；`manifest.cleanupLog` 有终局条目 ✓；**N03 双臂（747/748）步骤全为查询类**（`查询/重置/select_option/fill_form_field`，**无 save_*/提交**）→ 与"仅查询"一致 ✓；**我独立扫 122 次点击的按钮文案：写黑名单（删除/停用/注销/作废/强制/退回）0 命中** ✓ | **PASS**（口径见 F4） |
| 5 | **边界** | `git diff ea5d04c9..HEAD -- src/` = **0 行** ✓；门禁核 `--falsify-arm`/`--falsify-pair` 我各跑一次 → **④全 12 对红 / ②红 missing=[R01]**，verdict 与交付一致 ✓；**门禁在真实违规时确实 exit 1**（我读代码核 `exit = failed.length ? 1 : 0`；因 manifest 冻结，我没有篡改它去实测）；需求文本与 v2 评测集 **0 条完全相同**（6 处子串包含均为"对公客户评级/客户信息查询/风险分类统计"这类短菜单名被长需求文本包含，非评测条目复用）✓ | **PASS** |

## 2. 统计复核（我补的硬证据）

| 项 | 值 |
|---|---|
| A vs B 成功率 | 41.7% vs 50.0%（+8.3pp） |
| Wilson 95% CI | [19.3%, 68.0%] vs [25.4%, 74.6%]（独立复算一致） |
| 不一致对 | B 独赢 3 / A 独赢 2 |
| **精确 McNemar 双侧 p** | **1.000**（我算）——不一致对里**没有任何信号**，不只是"样本不够" |

→ **结论③「证据不足」采纳**，且比报告写得更硬：按配对检验，本轮数据既不能支持"有效"也不能支持"无效"，差异完全落噪声。

## 3. 发现

### F1（必改 · 证据一致性）：runlog 里 `#728` 一行与冻结结论直接冲突

`tmp/kb-ab/runlog.jsonl` 的 728 行写 `outcome:"recorded", isSuccessful:1, stepCount:null`；而**库终态是 `failed / is_successful=0 / step_count=0`**，报告 §2 也写 failed。733/741/742 都带 `runnerReadback:"recorded(transient)"` 标注，**唯独 728 没有任何标注**——runlog 是"跑批证据"，一行与冻结结果相反却没注明，会误导复算者。
**修法**：给 728 行补终态标注（如 `finalStatus:"failed(zero-action done)", dbCaliber:true`），或加一条 reconcile 说明。

### F2（必改 · 样本登记）：交付声称的两条 aborted 并未都登记在 `manifest.abortedRuns`

实测 `abortedRuns` **只有 2 条：722（setup 崩溃）与 723 run1（天元弹窗）**。
- **727 attempt1**：runlog 有行、`excludedFromStats:true` ✓，但**不在 `abortedRuns`**；
- **747 attempt1**：**既无 runlog 行、也不在 `abortedRuns`**，只以 `retryOf:"attempt1-aborted(executor-offline, no pr…"` 这个**被截断的字符串**存在于 attempt2 行里，完整理由（prepare 409 / WS 1006）**只写在报告正文**。

→ "非按结果剔除"的结论我**认可**（两条都无页面动作），但**登记形态不达标**：一条半只活在别行的字符串里。
**修法**：把 727 attempt1 与 747 attempt1 都补进 `manifest.abortedRuns`（含完整 reason/时间/id），或为 747 attempt1 补一条 runlog aborted 行。

### F3（必改 · 解释句）："B 独赢 3 对全是多腿任务"不成立，其中 1 对是已登记的环境降级

§3 写「B 独赢的 3 对全是多腿任务（R02 33 步、N02 39 步 vs A 预算耗尽失败）」。但第三对 **R05**：A 臂是 `#733` ——报告 §6.2 **自己登记的"navigate 零步异步降级"**（0 步、`runnerReadback: recorded(transient)`），B 臂只有 **4 步**。它不是"多腿预算耗尽"，它的不一致是**降级机制的配对内随机**（R11 两臂同降级 → 双败，就是反证）。
**修法**：价值形态结论**限缩到 R02/N02 两对**（这两对确实支持"卡把长链路做完"），把 R05 单列并注明受 §6.2 干扰影响；同时把上面的 **McNemar p=1.000** 写进 §1/§3，让"证据不足"有检验支撑而不只是功效估算。

### F4（轻 · 口径）：残留客户不止 8 笔

报告 §5 写「残留：8 笔新建客户」（正式批口径）；但 `manifest.cleanupLog[0]` 另有 **pilot 的 2 笔**（723 吴强杰 26091101181825853、724 KB主链R1-20260911-0125 26091101360078854）。建议写成「正式批 8 笔 + pilot 2 笔」。

### F5（轻 · 提交链）：报告漏列一笔

报告 §头部提交链止于 `e82bad07`，实际区间还有 `433ca3de`（runlog wallS 标注）与 `9bda883c`/`dcfe1063`。补全为 `ea5d04c9 → cf1751e6 → c1ef3ad7 → 5af3ab23 → e82bad07 → 433ca3de → 9bda883c → dcfe1063`。

### 观察（不挂账）

- runlog 是**异构追加日志**（`outcome/isSuccessful`、`recordStatus/trajectoryName`、`custNo`、末尾 `wallCorrections` 元数据行混排）——作为 ops 流水可接受，且**引擎正确地以库为准而非读 runlog**（这点做对了）；仅建议在文件头注明 schema 不保证同构。
- 744 的质量门伪失败已如实登记且红线内未改 `src/**` ✓，其引擎侧修法归属建议也已写进 §8 ✓。

## 4. 裁定

| 项 | 判定 |
|---|---|
| 结论③「证据不足」 | **采纳并加强**（McNemar p=1.000；+8.3pp 无信号） |
| "不得宣称有效/无效" | **采纳**——本轮确实两不成立 |
| 价值形态（"把预算内做不完的多腿链路做完"） | **限缩采纳**：仅 R02/N02 支持；R05 剔除（F3） |
| P5/P6 口径 | 采纳：遵循度两臂对称（B 不比 A 更贴卡）、写黑名单 0 命中（我独立复核） |
| 干扰项登记 | 采纳：744 门伪 / 零步降级 / paired SUT 故障 / executor 半掉线，四项均如实且方向正确 |
| 边界与纪律 | **通过**：`src/**` 零改动、未复用评测集、门禁可证伪且真实违规会 exit 1 |
| 残留与清理 | 通过（F4 口径补 2 笔 pilot） |

**必改 3 项 + 轻 2 项，一个收尾 commit 可全部完成（均为文档/登记级，不动数字、不重跑门禁）。**

**线状态：PASS（结论③成立，不计"有效"结论）。** 下一轮若要下 ±20pp 结论需 n≥40/臂——报告 §8 的升级路径（只复用多腿锚、砍单腿锚）我**认可**，并建议届时以**配对设计 + McNemar** 为主检验，而非两臂独立比例。

## 5. 收尾执行（2026-09-11，reviewer 代执行，`620dbe18`）

Lead 指示"只是文档就由你改"，故本案由 reviewer 直接收尾（**未碰 `src/**`、未碰任何观测量/统计量**）。

| # | 处置 | 落点 |
|---|---|---|
| F1 | runlog `#728` 行改为冻结 DB 口径（`outcome:"failed"`/`isSuccessful:0`/`stepCount:0`），runner 回读保留为 `runnerReadback:"recorded"`，并加 `finalStatusCaliber` 说明 | `tmp/kb-ab/runlog.jsonl` |
| F2 | `abortedRuns` 补入 **727 attempt1**（天元弹窗环境阻障）与 **747 attempt1**（executor 离线 / prepare 409），均带完整 reason + `excludedFromStats:true`；`changeLog` 增补审计条目。**`manifestVersion` 保持 v1.1 不升**——理由是实测到本线既有先例（`e82bad07` 追加 `cleanupLog` 未升版本），且升版会使冻结快照 `eval-final*.json` 失去逐位可比性、并需改动门禁的版本钉，而信息增益为零 | `scripts/kb/kb-ab-manifest.v1.json` |
| F3 | §3 价值形态限缩为 **R02/N02 两对**；R05 单列并注明其 A 臂 `#733` 属 §6.2 已登记的零步降级；§1/§3 增补 **精确 McNemar 双侧 p = 1.000** | 报告 §1/§3 |
| **F3+**（编辑中发现） | §5 原写"成功差异…来自卡提示块对任务分解本身的引导"——与结论③自相矛盾（差异未达可判定水平）。改为"即便存在差异，也不是来自更贴卡地走；P5 只作机制描述，不作收益论证" | 报告 §5 |
| F4 | 残留口径改为「正式批 8 笔 + pilot 2 笔」并给出 pilot custNo | 报告 §5/§8 |
| F5 | 头部提交链补全至 `dcfe1063`（含 `433ca3de`） | 报告头部 |
| 台账 | 新增 §9 G 复核响应台账（逐项对账 + 口径声明） | 报告 §9 |

**收尾后复验（我亲跑）**：门禁 **GREEN**（①manifest 形状/②配对 12/12/③臂平衡 12-12/④无跨臂污染/⑤收数完备 24/24 全 OK，exit 0）；两条证伪开关行为不变；`kb-ab-eval.mjs` 输出**仍与冻结 `eval-final.json` 逐位一致**（不升版本的收益）；`git diff -- src/` = **0**；报告数字 A 5/12、B 6/12、+8.3pp、两臂 CI **逐位未变**。

**一处自我更正**：我在判决 §3 写"747 attempt1 只以**被截断**字符串活在 attempt2 行里"——**"被截断"是我打印时的显示截断**，原文 `notes` 里理由完整。F2 的实质（无独立条目、未登记 abortedRuns）成立且已修复，但该措辞是我的失准。

**线状态：PASS → CLOSED（结论③「证据不足」，不计"有效"）。** 下一轮若要下 ±20pp 结论需 n≥40/臂——报告 §8 的升级路径（只复用多腿锚、砍单腿锚）我**认可**，并建议届时以**配对设计 + McNemar** 为主检验，而非两臂独立比例。
