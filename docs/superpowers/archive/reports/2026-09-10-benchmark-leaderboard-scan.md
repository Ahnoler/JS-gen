# Current benchmark leaderboard scores (as of 2026-09-10)

Method: web_search + web_fetch. Primary sources preferred; I pulled **raw leaderboard JSON** where the site exposed it (cybergym.io, deepswe mirror via BenchLM) rather than scraping rendered HTML. Every number below is copied from a fetched page. Where a benchmark has no official leaderboard I say so.

## 1. DeepSWE (v1.1 is the live board)
Official site https://deepswe.datacurve.ai is a JS SPA whose data endpoints return HTML, so the numbers below come from **BenchLM's mirror**, which states it mirrors the public DeepSWE leaderboard JSON using the best available mini-swe-agent config per model. All rows are **mini-swe-agent**; DeepSWE scores a (model, harness, effort) triple, not a bare model.

| # | Model + config | Score (pass@1) | Source | As-of |
|---|---|---|---|---|
| 1 | Gemini 3.8 Flash - mini-swe-agent - high | 73.8% | https://benchlm.ai/benchmarks/deepswe | 2026-09-01 |
| 2 | Claude Opus 5 - mini-swe-agent - max | 73.6% | same | 2026-09-01 |
| 3 | GPT-6 Astra - mini-swe-agent - max | 73.2% | same | 2026-09-01 |
| 4 | GPT-5.6 Sol - mini-swe-agent - max | 72.7% | same | 2026-09-01 |
| 5 | Claude Fable 5 - mini-swe-agent - max | 69.7% | same | 2026-09-01 |
| 6 | GPT-5.6 Terra - mini-swe-agent - max | 69.6% | same | 2026-09-01 |
| 7 | GLM-5.3 - mini-swe-agent - max | 69.0% | same | 2026-09-01 |
| 8 | Kimi K3 - mini-swe-agent - max | 68.5% | same | 2026-09-01 |

Also on board: DeepSeek V4 Pro 0813 62.8% (#14), DeepSeek V4 Flash 0731 53.3% (#20), Claude Opus 4.8 59.0%, Qwen3.8 Max 57.5%, Grok 4.6 66.7%, GPT-5.5 67.0%.
**v1.1 exists**: shipped 2026-06-14, v1 frozen, v1.1 live (https://deepswe.datacurve.ai/blog/deepswe-v1-1). Grading moved from exit-code to specific test node IDs; pooled pass rate 0.509 -> 0.518. Independent audit: https://june.kim/auditing-deepswe-v1-1/

## 2. ProgramBench
Official leaderboard, harness **mini-SWE-agent** for every row, 200 tasks. Two columns: Resolved (fully solved) and Almost (>=95% of behavioral tests).

| # | Model + config | Resolved | Almost | Source | As-of |
|---|---|---|---|---|---|
| 1 | Claude Opus 5 (xhigh) | 4.5% | 37.0% | https://programbench.com/ | 2026-09-09 |
| 2 | GPT-5.6 Sol (xhigh) | 1.0% | 15.5% | same | 2026-09-09 |
| 3 | GPT 5.5 (xhigh) | 0.5% | 13.5% | same | 2026-09-09 |
| 4 | GPT 5.5 (high) | 0.5% | 5.0% | same | 2026-09-09 |
| 5 | Gemini 3.6 Flash | 0.5% | 4.0% | same | 2026-09-09 |
| 6 | GPT-5.6 Sol (default effort) | 0.5% | 2.5% | same | 2026-09-09 |
| 7 | Claude Opus 4.8 (xhigh) | 0.0% | 16.5% | same | 2026-09-09 |
| 8 | GLM-5.2 | 0.0% | 8.5% | same | 2026-09-09 |

BenchLM mirror agrees within rounding (https://benchlm.ai/benchmarks/programbench, 2026-08-16). Paper https://arxiv.org/abs/2605.03546

## 3. NL2Repo-Bench
**No benchmark-native public leaderboard found.** Only aggregator data (BenchLM, 25 models, 2026-09-08). The benchmark originates from MiniMax (cited in https://www.minimax.io/news/minimax-m27-en); BenchLM describes it as "repository understanding" rather than the MiniMax repo-generation framing.

| # | Model | Score | Source | As-of |
|---|---|---|---|---|
| 1 | DeepSeek V4 Pro 0813 | 61.5% | https://benchlm.ai/benchmarks/nl2repo | 2026-09-08 |
| 2 | Ornith-1.5-397B | 59.5% | same | 2026-09-08 |
| 3 | Hy4 preview (Tencent) | 58.9% | same | 2026-09-08 |
| 4 | GLM-5.3 | 58.0% | same | 2026-09-08 |
| 5 | GLM-5.3-Flash | 56.3% | same | 2026-09-08 |
| 6 | Qwen3.8 Max | 55.9% | same | 2026-09-08 |
| 7 | DeepSeek V4 Flash 0731 | 54.2% | same | 2026-09-08 |
| 8 | dots3-note Preview | 49.8% | same | 2026-09-08 |

## 4. CyberGym (Level 1 success rate)
Official machine-readable board: **https://www.cybergym.io/assets/data/cybergym.json** (70 entries). Rows are agent+model pairs; success rate = % of 1,507 instances reproducing the vulnerability with a working PoC.

| # | Agent | Model | Success | Date | Flags |
|---|---|---|---|---|---|
| 1 | Sangfor AI | GLM-5.3 | 97.21% | 2026-09-02 | orchestration, multi-stage, dynamic |
| 2 | Alipay AI4SDL | GLM-5.3 | 96.75% | 2026-09-06 | dynamic |
| 3 | Hero Agent | Hero (finetuned GLM-5.2) | 96.62% | 2026-09-03 | dynamic, test-time memory |
| 4 | Creation | multi-model (Creation, DeepSeek-V4-Pro, Qwen 3.8 Max) | 95.35% | 2026-08-30 | multi-model, dynamic |
| 5 | NSFOCUS AI | GLM-5.3 | 95.02% | 2026-08-13 | dynamic |
| 6 | DoGNAVY | GLM-5.3 | 94.96% | 2026-08-17 | multi-agent, memory, dynamic |
| 7 | RO0T Agent | DeepSeek-V4-Flash | 94.16% | 2026-08-26 | dynamic |
| 8 | Spur | Qwen-Internal | 91.84% | 2026-09-03 | none |

Frontier-lab rows for contrast: Claude Code + GLM-5.3 84.5%; DeepSeek Agent + DeepSeek-V4-Pro 83.3% (2026-08-13); OpenAI Agent + GPT-5.5 81.8%; Anthropic Agent + Claude Mythos Preview 83.1%; Claude Code + GLM-5.2 77.2%; DeepSeek Agent + DeepSeek-V4-Flash 76.7%; Gemini CLI + Gemini 3.1 Pro 38.8%. Source: https://www.cybergym.io/cybergym/ (scores submitted by individual teams; runs are stochastic).

## 5. SEC-Bench and SEC-Bench Pro
**SEC-Bench (original)** - no public per-model leaderboard found. Paper only: https://arxiv.org/abs/2506.11791 (v2, 2025-10-22) reports best-in-class agents reach **at most 18.0% success at PoC generation** and **34.0% at vulnerability patching** on the complete dataset. No named top-8 table.

**SEC-Bench Pro** - 344 validated vulnerabilities (V8, SpiderMonkey, Linux kernel). Paper https://arxiv.org/abs/2605.26548 (v2, 2026-07-20): strongest config **Codex + GPT-5.5 solves 58% overall**; Claude Code + Opus 4.6 tends to time out but solves most instances it finishes; **GLM-5 solves 13/344** (3.8%). Provider-run rows on BenchLM (from OpenAI's GPT-5.6 launch table, 2026-09-08): GPT-6 Astra 85.4%, GPT-5.6 Sol 71.2%, GPT-5.5 45.8%. https://benchlm.ai/benchmarks/secbenchpro

## 6. ExploitGym
Official JSON: **https://www.cybergym.io/assets/data/exploitgym.json** - 869 tasks (502 userspace / 181 V8 / 186 kernel). "on_target" = exploits that used the intended vulnerability (the reported metric). Budgets differ per row.

| # | Model + config | Agent/scaffold | On-target exploits | Flag captures | Budget | Date | Source |
|---|---|---|---|---|---|---|---|
| 1 | GPT-5.6 Sol (reasoning max) | Codex CLI | 293 | - | 6h | 2026-07-13 | https://deploymentsafety.openai.com/gpt-5-6 |
| 2 | Claude Mythos 5 | not stated | 247 | - | 6h | 2026-06-09 | https://anthropic.com/claude-opus-5-system-card |
| 3 | Claude Opus 5 | not stated | 191 | - | 6h | 2026-07-24 | same |
| 4 | Claude Mythos Preview | Claude Code | 157 | 226 | 2h | 2026-05-13 | ExploitGym Team |
| 5 | GLM-5.3 | Claude Code | 130 | - | rescaled 6h | 2026-08-18 | https://z.ai/blog/glm-5.3 |
| 6 | GPT-5.5 | Codex CLI | 129 | 208 | 2h | 2026-06-16 | ExploitGym Team |
| 7 | Claude Opus 4.8 | not stated | 120 | - | 6h | 2026-05-28 | Anthropic system card |
| 8 | GLM-5.2 | DoGNAVY | 79 (selected subset) | - | n/a | 2026-08-22 | https://github.com/DogNavy/DoGNAVY-Exploitation |

Also: GPT-5.4 + Codex CLI 61; Claude Opus 4.6 + Claude Code 16; Gemini 3.1 Pro + Gemini CLI 12; Claude Opus 4.7 + Claude Code 12; GLM-5.1 + Claude Code 4; Muse Spark 1.1 + Meta Agent 7.

## 7. Automation-Bench - two distinct boards
**(a) AutomationBench (Zapier official).** Moonshot ran the 600-task public subset following the official GitHub setup. BenchLM, 2026-09-08:

| # | Model | Score | Source |
|---|---|---|---|
| 1 | Muse Spark 1.3 | 49.4% | https://benchlm.ai/benchmarks/automationbench |
| 2 | GLM-5.3-Flash | 48.8% | same |
| 3 | GLM-5.3 | 48.2% | same |
| 4 | GPT-6 Astra | 41.4% | same |
| 5 | Hy4 preview | 32.1% | same |
| 6 | DeepSeek V4 Pro 0813 | 31.8% | same |
| 7 | Claude Fable 5.1 | 31.4% | same |
| 8 | Kimi K3 | 30.8% | same |

**(b) AutomationBench-AA (Artificial Analysis private subset, 657 tasks).** Headline = objectives completed *without violating guardrails*; model runs in AA's harness, 50-turn cap.

| # | Model + config | Score | Source | As-of |
|---|---|---|---|---|
| 1 | GPT-6 Astra | 68.5% | https://benchlm.ai/benchmarks/aaautomationbench | 2026-09-08 |
| 2 | Grok 4.6 | 66.7% | same | 2026-09-08 |
| 3 | GLM-5.3 | 62.2% | same | 2026-09-08 |
| 4 | GLM-5.3-Flash | 60.4% | same | 2026-09-08 |
| 5 | GPT-5.6 Sol | 60.1% | same | 2026-09-08 |
| 6 | Gemini 3.8 Flash | 59.9% | same | 2026-09-08 |
| 7 | GPT-5.6 Terra | 59.6% | same | 2026-09-08 |
| 8 | Claude Fable 5.1 | 59.4% | same | 2026-09-08 |

Official launch article (2026-07-06) had much lower absolute numbers: Claude Fable 5 (max) 48.6%, Claude Opus 4.8 48.5%, Gemini 3.5 Flash 42.6%, GPT-5.5 (xhigh) 42.1%, GLM-5.2 (max) 27.8% (best open weights). https://artificialanalysis.ai/articles/announcing-zapier-automationbench-aa

## 8. Agents' Last Exam (ALE)
UC Berkeley RDI, 1,000+ tasks, 13 industry clusters. **Benchgen hosts the leaderboard**: https://benchgen.com/benchmarks/berkeley/agents-last-exam

| # | Model | Score | Same on BenchLM (2026-09-08)? |
|---|---|---|---|
| 1 | gpt-6-astra | 59.3 | 59.3% |
| 2 | deepseek-v4-flash-vision-exp | 27.3 | not listed (V4 Flash 0731 = 25.2%) |
| 3 | gpt-5-6-sol | 52.7 | not listed |
| 4 | qwen3-8-max | 52.4 | 52.4% |
| 5 | qwen3-8-flash-next | 51.2 | 51.2% |
| 6 | gpt-5-6-terra | 50.4 | not listed |
| 7 | gpt-5-6-luna | 50.3 | not listed |
| 8 | claude-fable-5 | 48.7 | not listed |

BenchLM also lists: Qwen3.8-27B 42.9%, GLM-5.3 28.5%, Gemini 3.7 Flash 26.3%, GLM-5.3-Flash 26.3%, DeepSeek V4 Pro 0813 25.7%, Hy4 preview 22.8%. https://benchlm.ai/benchmarks/agentslastexam
**No DeepSeek-V4.1-Flash, no Grok 4.6, no Kimi K3 row.**

## 9. Chartography (with tools)
Partial - no single official with-tools leaderboard. Surge AI's own board (https://surgehq.ai/benchmarks/chartography) is **no-tools**; the with-tools numbers come from Anthropic's model card section 8.12.1 and are the only public ones.

**With tools (Claude Opus 5 system card, 5-run max-effort average):**

| # | Model + config | Score | Source | As-of |
|---|---|---|---|---|
| 1 | Claude Opus 5 (with image + code tools) | 83.0% | https://benchlm.ai/benchmarks/chartographywithtools | 2026-08 |
| 2 | GLM-5.3-Flash (with tools) | 78.0% | same | 2026-08 |

**No-tools, for calibration** (official Surge AI): Claude Fable 5.1 (Adaptive/Max) 46.2%; GPT 5.6 Sol (Max) 45.0%; Claude Fable 5.1 (Adaptive/High) 44.1%; Gemini 3.7 Flash (Medium) 43.0%; Gemini 3.8 Flash (Medium) 42.5%; Gemini 3.8 Flash (High) 40.9%; Gemini 3.7 Flash (High) 40.4%; GPT 5.6 Sol (Medium) 39.5%. Claude Opus 5 lands at 27.3% (Adaptive/Max) / 25.7% (Adaptive/High) no-tools - BenchLM lists Opus 5 at 29.6% for its no-tools key.

## 10. BabyVision (with tools)
Partial - no benchmark-native leaderboard. Numbers are provider-reported (Kimi K3 report, Qwen/Meta launch posts, Muse Spark 1.1 report). GitHub: https://github.com/UniPat-AI/BabyVision

**With Python/tools (BenchLM, 2026-09-08):**

| # | Model | Score | Source |
|---|---|---|---|
| 1 | Qwen3.8 Max | 91.3% | https://benchlm.ai/benchmarks/babyvisionpython |
| 2 | Kimi K3 | 85.7% | same |
| 3 | Qwen3.8-27B | 85.6% | same |

**No-tools (BenchLM):** Qwen3.8 Max 82.0%, Muse Spark 1.1 76.3%, Qwen3.8-27B 65.7%, GLM-5.3-Flash 53.4%, dots3-note Preview 50.0%. https://benchlm.ai/benchmarks/babyvision
Benchgen's BabyVision phase lists only 2 submissions: kimi-k3 85.7 (w/ Python), qwen3-8-27b 65.7. https://benchgen.com/benchmarks/unipat-ai/babyvision - last modified 2026-07-28.

## 11. ITBench-AA - exists
Artificial Analysis + IBM, Kubernetes incident root-cause analysis, 59 SRE tasks (40 public + 19 held-out), **Stirrup harness held constant**, 100-turn cap, 3 repeats. Leaderboard: https://artificialanalysis.ai/evaluations/itbench-aa

| # | Model + config | Score | Source | As-of |
|---|---|---|---|---|
| 1 | GPT-5.6 Sol | 56.2% | https://benchlm.ai/benchmarks/aaitbench | 2026-09-08 |
| 2 | GPT-5.6 Terra | 51.0% | same | 2026-09-08 |
| 3 | Kimi K3 | 47.7% | same | 2026-09-08 |
| 4 | Claude Opus 4.7 (Adaptive) | 46.7% | same | 2026-09-08 |
| 5 | GPT-5.5 | 45.8% | same | 2026-09-08 |
| 6 | GLM-5.2 | 42.7% | same | 2026-09-08 |
| 7 | Qwen3.7 Max | 42.5% | same | 2026-09-08 |
| 8 | Gemini 3.5 Flash | 40.3% | same | 2026-09-08 |

Official launch article (2026-05-27) numbers: Claude Opus 4.7 (Adaptive/Max) 47%, GPT-5.5 (xhigh) 46%, Qwen3.7 Max 42%, GLM-5.1 (Reasoning) 40%, DeepSeek V4 Pro (Reasoning, Max Effort) 38%, Gemma 4 31B (Reasoning) 37%, Gemini 3.1 Pro Preview 30%. https://artificialanalysis.ai/articles/itbench-aa-launch

---

# Conflicts & caveats

1. **DeepSWE official data is not directly fetchable.** deepswe.datacurve.ai is a client-rendered SPA; every candidate data path returns the HTML shell. All DeepSWE numbers above are BenchLM's mirror, which claims to mirror the official JSON but may lag. Treat DeepSWE ranks 1-4 (73.8/73.6/73.2/72.7) as within-noise of each other - the source itself notes rows differ by harness and effort, not model alone.
2. **DeepSWE v1 vs v1.1.** v1.1 (2026-06-14) is live, v1 frozen. An independent audit (june.kim, 2026-07-07) reports v1.1 still ships inconsistencies: heatmap charts 8 models where the leaderboard ranks 10; the "timeouts score as failures" rule is contradicted by trial rows with agent_timeout + passed:true; one config is scored over 111 of 113 tasks; node-ID scoring is unverifiable from shipped artifacts.
3. **ExploitGym task count conflict.** Official JSON says **869** tasks (502/181/186). BenchLM normalizes to **898** and derives percentages (GPT-6 Astra 42.4%, GPT-5.6 Sol 33.7%, Claude Mythos Preview 17.5%). The official board reports raw counts and does not publish GPT-6 Astra at all. Do not mix the two.
4. **ExploitGym budgets are inconsistent across rows** (2h vs 6h vs "rescaled 6h"). The official page itself notes that extending 2h to 6h kept Claude Mythos Preview climbing 127 to 204 while Opus 4.6 flatlined near 15. Raw counts across different timeouts are not comparable. Several rows additionally use a "selected subset" (GLM-5.2/DoGNAVY) or are marked hidden (Claude Mythos Preview).
5. **ExploitGym off-target exploits.** The official blog states GPT-5.5 captured flags in 210 instances but only 120 used the intended bug, and Claude Mythos Preview 226 vs 157. The JSON's flag_captured and on_target fields differ for exactly this reason; I tabulated **on_target** as the metric.
6. **AutomationBench vs AutomationBench-AA are different benchmarks** with different task sets, harnesses and scoring anchors (public 600-task subset vs 657 private tasks with guardrail-violation scoring). Never compare across the two columns.
7. **AutomationBench-AA jumped ~20 points in ~2 months** (48.6% top score on 2026-07-06 vs 68.5% on 2026-09-08). Either a harness/scoring revision or genuine model progress - AA's changelog mentions Intelligence Index v4.3 adding AutomationBench-AA on 2026-09-07, which is a plausible discontinuity. Treat pre/post-September AA AutomationBench numbers as a different scale until confirmed.
8. **SEC-Bench Pro has two incompatible scales.** The paper's 58% (Codex + GPT-5.5, 344 tasks) vs BenchLM's 71.2% for GPT-5.6 Sol / 45.8% for GPT-5.5 are not the same measurement - BenchLM explicitly stores provider-run values from OpenAI's launch table as display-only "until benchmark-native results are available." GPT-5.5 at 45.8% (OpenAI-run) vs the paper's 58% for the same model is a direct contradiction.
9. **CyberGym is dominated by bespoke agent scaffolds, not models.** The top 8 are all custom systems (Sangfor, Alipay AI4SDL, Hero, Creation, NSFOCUS, DoGNAVY, RO0T) and most carry "dynamic" (sanitized Docker image) and/or "test-time memory" flags - the official page states these "denote different evaluation strategies, rather than a reduction in task difficulty," but they are not apples-to-apples with frontier-lab rows. Several top rows also use GLM-5.3 as backbone, so this is largely an agent-engineering leaderboard.
10. **CyberGym near-saturation makes small gaps meaningless.** The official page warns that with leading systems above 90%, "modest score differences may not reflect meaningful capability gaps." Ranks 1-6 span 97.21% to 94.96%.
11. **Chartography (tools) has essentially no leaderboard** - 2 models, both from a single vendor's model card (Anthropic's implementation of Surge's tasks and ranges). It is not comparable to Surge's own no-tools board (top score 46.2%). Calling it "with tools" is accurate but the population is tiny.
12. **BabyVision has no official board at all.** All rows are provider-reported and BenchLM explicitly keeps "with Python" separate from the base key because they are different evaluation modes. Qwen3.8 Max's 91.3% is a single-vendor claim.
13. **ITBench-AA old vs new rows conflict.** The May article puts Claude Opus 4.7 at 47% and Qwen3.7 Max at 42%; BenchLM's September snapshot puts Claude Opus 4.7 (Adaptive) at 46.7% (consistent) but Qwen3.7 Max at 42.5% and adds GPT-5.6 Sol at 56.2%. Only GPT-5.5 (46% vs 45.8%) matches cleanly across both, so the boards are consistent within rounding but the September rows come from BenchLM's mirror of AA, not from an AA page I could render.
14. **BenchLM is an aggregator, and several of these tables rest on it alone** (NL2Repo, SEC-Bench Pro, ITBench-AA, plus the DeepSWE mirror). Its own pages label most of these "display-only" and "excluded from the weighted scoring formula."
15. **DeepSeek-V4.1-Flash has no rows on any of these 11 boards.** It launched **today, 2026-09-10** (https://api-docs.deepseek.com/zh-cn/news/news260910/). The official post is a 552B MoE with a Causal-Encoder-Decoder structure and states it beats V4 Pro on agentic benchmarks, but the comparison is published as an **image chart**, so no machine-readable numbers exist yet. DeepSeek V4 Flash and V4 Flash Vision Exp are retired and routed to V4.1 Flash; V4 Pro is being retired from 2026-09-14. Anyone benchmarking DSv4 today is measuring a deprecated endpoint.
16. **DeepSeek-V3.2-Speciale: no rows found** on any of the 11 benchmarks. Searched directly and via the DeepSeek changelog; the DeepSeek rows present are V4 Pro 0813 / V4 Flash 0731 only. Same for **Kimi K2.x** (only Kimi K3 appears) and **Grok 4.x** (only Grok 4.5/4.6 on DeepSWE, AutomationBench-AA, and CyberGym).
17. **Gaps:** no public scores found for NL2Repo-Bench (native board), SEC-Bench original (per-model table), Chartography with-tools (beyond 2 rows), BabyVision (native board). **All 11 benchmarks named in the request do exist publicly**, including ITBench-AA.