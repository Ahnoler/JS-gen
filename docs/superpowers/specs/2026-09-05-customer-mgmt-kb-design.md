# 客户管理知识库贯通 — 设计

> 日期：2026-09-05  
> 状态：已选方案 1（先卡后录）+ 验证路径 C（遗留参考 → 新增交易 AI 分析 → 按阶段录制）  
> Lead：本会话；范围档位 **A**（仅对公客户建档闭环）  
> 用户确认：2026-09-05（合同因影像不适；选客户管理；最小成功 A）

## 1. 目标

在信贷 SUT（`test.creditv5p2`）**客户管理**模块，打通「对公客户建档」主链并沉淀可召回 KB；贯通证据走本产品路径：

**遗留交易参考（可选浅读）→ 加固流程卡 → 新增交易（含任务）→ AI analyze → prepare → record/start**。

成功终态（最小集）：

1. `data/kb/flows/customer_onboarding.json` 可被 `kb_flow` 正确召回（菜单/hash 对齐 **对公客户管理**）。
2. 新建一条交易：`task`/`requirement` 非空，phases 来自 analyze，按阶段录制产生步骤。
3. SUT 证据：列表能查到 **stamp 客户名**（如 `KB测客户-YYYYMMDD-HHMM`）；进入编辑上下文页即可（不强制全字段填齐）。

## 2. 范围

### In

- 菜单：客户管理 → **对公客户管理**（正式叶子）。
- **挂载 functionId = `7`**（菜单 intermediate 孪生合入后：`9000001478`→`7`；`RES000000101` / `pd_cmpt_ecd=ZJJK00066153`）。**勿**再写 1478。
- 主链：进页 → 查重/新增校验抽屉 → 保存进入编辑上下文 → 列表可按 stamp 查到。
- 回写卡：`menu_path` / `hash_markers` / preconditions / rules；**OCR / 影像禁入**。
- 法定代表人「引入」：能做则做；阻塞则浅过并写入 `exceptions`。
- 可选：列表点开 360 只读核对（不强制成录制阶段）。
- 账号：优先 `systemAccountId=2`；权限不足再换。

### Out（本轮不做）

- 个人/集团/同业/集群客户管理；移交；进件；征信；黑名单等旁路。
- 客户信息查询独立卡（档位 B）。
- 合同/用信/影像上传链路。
- 改 `_kb.py` / `promote.py` / 共享 prompts（除非召回缺口强制，且先 agent-log 声明）。
- 触碰用信/授信/产品线 WIP；改菜单扫描代码。

## 3. 架构与数据流

```
遗留对公客户 traj（只读，可选） + 现有 customer_onboarding.json
        │
        ▼
  任务文案（stamp）+ 卡回写（fid=7）
        │
        ├─► data/kb/flows/customer_onboarding.json
        │
        └─► POST /api/v2/trajectories/analyze
                │
                ▼
            POST /api/v2/trajectories  (functionId=7, requirement+phases)
                │
                ▼
            record/prepare → record/start
                │
                ▼
            through-report + source 回填
```

卡 schema 对齐既有：`flow` / `aliases` / `menu_path` / `hash_markers` / `preconditions` / `nodes` / `rules` / `exceptions` / `source`。

## 4. 验证路径

1. 确认叶子 `7` 可导航（menu_xpath + pageId）。
2. 定稿任务文案（编号分步 + 关键数据 stamp；成功判据=列表见 stamp）。
3. analyze → 建交易 → prepare → start。
4. 报告：trajectoryId、阶段结果、stamp、卡 source。

API 等价路径允许；最终证据须含「含任务内容的新交易 + 阶段步骤」。

## 5. 纪律

- Python：`D:/anaconda3/python.exe` 或 `./python/python.exe`。
- 双开：不抢用信 Playwright/槽位；空闲槽录制。
- 收工：`docs/superpowers/agent-log.md`；commit 按用户/协议要求。
- `tmp/customer-mgmt/` 作证据目录（gitignore 下临时文件）。

## 6. 风险

| 风险 | 缓解 |
|------|------|
| 卡仍写「客户信息维护」中间路径 | 回写为「客户管理→对公客户管理」；勿挂 intermediate |
| functionId 误用 1478 | 一律 **7**（合入后正式 id） |
| 建档字段多 / 引入控件脆 | 成功=列表 stamp；引入可浅 |
| OCR 入口 | 任务与卡明确禁入 |

## 7. 非目标回顾

不做全模块客户管理普查；不做合同影像；不与用信会话抢同一客户单据 unless Lead 协调。
