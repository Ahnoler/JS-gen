# 方向 5 R-3 go/no-go 裁定：**NO-GO**（口语语料在库中不存在）

> 日期：2026-09-11 · 取证：DSH reviewer（VPN 恢复后亲自查库）
> 上游裁定：[`specs/2026-09-10-colloquial-bridge-closeout-decisions.md`](../specs/2026-09-10-colloquial-bridge-closeout-decisions.md) §4.3/§4.4（R-3 条件立项，前置=数据源）
> **结论：三条独立理由中任一条都足以否决 → R-3 NO-GO → 方向 5 彻底收口（R-2 词面桥 + R-3 语料回收 双否）。**

## 1. 访问方式（口令不入库）

```bash
# config/open-db-tunnel.cmd 等价命令（Windows OpenSSH；口令由 Lead 提供，交互式输入）
ssh -N -o ServerAliveInterval=30 -L 13306:127.0.0.1:3306 -p 22 root@47.101.58.49
# 随后按 config/.env 的 DB_USER/DB_PASS/DB_NAME 连 127.0.0.1:13306（只读）
```

> **订正（2026-09-11，reviewer 自查）**：本节原写「库只经 SSH 隧道可达」，这是把一次**白名单空窗**当成了常态。实测：**直连 `47.101.58.49:3306` 可用**——raw TCP **46ms**，且 `SELECT COUNT(*)` 真实查询成功（trajectory **421** 行 / `batch_recording_item` 需求 **98** 条）。正确口径：**主路径=直连**（`config/update-db-whitelist.ps1` 常开窗口每 600s 同步出口 IP）；**隧道=空窗期兜底**（VPN 重拨换出口 IP，白名单最多滞后 10 分钟）。**R-3 的 NO-GO 结论不受影响**——它依据的是库内容（有无口语语料/卡片配对），与访问方式无关。

## 2. 实测数据（`js_gen`）

| 项 | 实测 |
|---|---|
| `trajectory` 总行数 | **416** |
| `task` 非空 | **404**（去重后 **241**） |
| `kb_flow_ref` 非空 | **0** |
| `req_module_key` 非空 | **0** |
| `task` 三类构成 | run-label **177**（如「KB-I5 引擎湿测 额度冻结第五轮」）· agent-test-brief **95**（「【硬性成功门闩——未满足不得 done】…」）· step-list **60**（「1、点击客户管理，点击对私客户管理。2、新增一个对私客户…」）· other 72 |
| step-list 去重 | **49** 条，覆盖 **10** 个 `function_id` |
| `batch_recording_item.requirement` | 98 条非空 / **去重仅 37**（同一 `新增个人客户N.by批量` 在多个批次重复） |
| 全库 distinct `function_id` | 58 |
| 相关表 | 34 张；`batch_recording_item`（有 `requirement`）、`trajectory_phase`（LLM 阶段文案）、`memory_fact`（2912 行，无需求原文） |

## 3. 三条独立否决理由

1. **量不足**：能算"用户/QA 手写需求文本"的去重后 ≈ **49（step-list）+ 37（batch，且与前项高度重叠）**，远低于 §4.4 的门槛（配对 ≥200、≥3 模块）。模块覆盖只有 10 个 `function_id`。
2. **质不符（口语性）**：step-list 不是口语转述，而是**产品词表内的操作步骤**——「点击客户管理，点击对私客户管理」「新增一个对私客户。预期结果：点击保存后…」。用它建桥得到的仍是**领域词↔领域词**，正是已完成两轮验证并失败的那个形态（P0 反推 1/115；本线语料正向 0/245）。E 层要的是「把客户的口子先封住不让他接着支取」这类**零词面重叠**的说法，库里没有。
3. **配对不存在**：`kb_flow_ref` / `req_module_key` **全表为 0**（列在、数据空）。即便语料合格，也没有"口语文本 ↔ 卡片"标签；只能靠 `function_id` → 交易 → KB 线性血缘反推，损耗大且无监督信号。

## 4. 裁定与后果

- **R-3 NO-GO** → 按 §4.4 第 5 条，**方向 5 彻底收口**，不再追加投入。
- 与本线 R-2（零依赖词面桥关闭）合起来：**方向 5 的两个分支均以实测否决**，结论文档化在此。
- `data/kb/colloquial-bridge.json`（archived，67 条）保留为续跑基线；三条资产 pin 与 `--synonyms` 留痕机制（R-1）保留为护栏。
- embedding（R-4）维持押后：其收益验证同样依赖"口语↔卡片"配对，而本次已证明该配对在库中不存在。

## 5. VPN 恢复后的环境状态（2026-09-11，reviewer 实测）

| 依赖 | 实测 | 状态 |
|---|---|---|
| LLM 网关 `172.19.87.169:3000` | `callLLM('只回复两个字：可用')` → **"可用"（778ms）** | ✅ |
| 轨迹库 `47.101.58.49:3306` | 直连仍超时（IP 白名单）；**SSH 隧道 127.0.0.1:13306 通**，416 行 | ✅（需隧道） |
| SUT `test.creditv5p2.tansun.com.cn` | **HTTP 200 / 226ms**（app shell） | ✅ |
| partner `test.atp.tansun.com.cn` | DNS → 172.19.87.169 | ✅ |
| 浏览器 | Playwright 1.58 + chromium 1208/1217/1228 + 本机 Chrome | ✅ |
| 本地控制面 4097 | 未运行（`npm start` 可起；注意 agent-log 记录：重启不要打断在途录制） | ⚠️ 可起 |

**含义**：方向 1（atom → record → replay 一条真实交易）与方向 2（KB 价值 A/B）**已具备执行条件**。

## 6. 复现命令

```bash
ssh -N -L 13306:127.0.0.1:3306 -p 22 root@47.101.58.49        # 隧道（口令交互）
node tmp/review-bridge/pAC-dbq.mjs                            # 行数/列清单
node tmp/review-bridge/pAD-r3.mjs                             # 配对可得性（kb_flow_ref/req_module_key）
node tmp/review-bridge/pAE-r3b.mjs                            # task 字符统计 + 34 张表
node tmp/review-bridge/pAG-r3d.mjs                            # 去重/分类/模块覆盖（本报告 §2 的数字）
node tmp/review-bridge/pAI-suthttp.mjs                        # SUT HTTP 可达性
```

> 探针位于 `tmp/review-bridge/`（`tmp/` 被 gitignore，未入库）；§2 的口径与数字可照上表重算。
