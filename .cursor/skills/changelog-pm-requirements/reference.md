# CHANGELOG 数据来源与指标参考（JS-gen）

本文件供编写 `CHANGELOG.md` 时查数；其他项目复制 skill 后请替换为该项目的路径与指标。

## 优先数据源（按可信度）

1. **`docs/superpowers/agent-log.md`** — 收工条目的完成/验收/遗留
2. **`docs/superpowers/archive/logs/agent-log-archive-*.md`** — 历史条目
3. **`CHANGELOG.md` 同 Release 其他小版本** — 避免重复计数
4. **`docs/report/`** — 日报（gitignore，只读参考）
5. **git log** — 找日期与规模，**不**直接抄 commit 当需求

## 本仓库常用实测指标

| 类别 | 典型写法 | 常见来源 |
|------|----------|----------|
| 湿测 | wet9 全链、wet8 三单、6/6 PASS | agent-log 收工 |
| 贯通 | T4 53/53、stepCount + stamp | KB 战役 09-06 |
| 规模 | 30/30 模块、~1958 叶、174 草稿 | req 湿测战役 |
| flows | 29→82（+183%）、63 张晋升 | promote_draft |
| KB 召回 | Acc@1 0.65→0.74、130 条基线 | recall-eval |
| KB 加固 | 13 项 PASS、A/B 24/24 | kb-remediation |
| 假成功 | 24 条零步清洗、engine-wet-trio PASS | 门闩线 |
| 门禁 | verify-all 208/211、27/27 pin | verify-all / characterization |
| 主链 | R1–R5 PASS、引擎闭环 ~90% | P6 计划 / agent-log |
| 发版 | 20260919 批次可部署 | release-backend |

## 估算指标写法

当无直接统计时使用，**必须标「估」**：

- 成功率 `40%→85%+（估）`
- 失败率/点错 `估降 50%+`
- 工时 `估省 50%+` / `2~3 人日/模块`
- 省时 `约 70%（估）`
-  qualitative → quantitative bridge：`阻塞项估清 90%+`

估算应合理、可辩护；用户会自行删改偏大的数。

## Release / 小版本划分（本仓库）

| Release | 分支 | 说明 |
|---------|------|------|
| V2.0 | `uara_V2.0` | 2026-09-19 起，用户负责基础线 |
| V1.2 | `uara_V1.2` | 2026-09-19 冻结，已合入 V2.0 |
| v2.0.1+ | 同事线 | **不写入** CHANGELOG 已解决 |

双周小版本：按迭代日历切；重叠日期在写法约定中注明筛重。

## 需求合并映射（技术 → 产品）

| 技术主题 | 产品需求表述 |
|----------|--------------|
| STC / err-search-first | 列表/树须先查询再点选 |
| placeholder-only 搜索框 | 输入 + 点击搜索完整操作链 |
| first row/leaf + 结构 xpath | 首行/首叶 + 支持回放换参 |
| Select/Fill/RadioEngine | 基础控件录放行为统一 |
| draft-traj propose/commit | 需求文档两段式生成草稿交易 |
| capability-cohesion | 草稿拆分质量可控 / 能力内聚 |
| 坐标归一化 / RSCF | 推送伙伴可点亮 / BiB 推流稳定 |
| phase contract / done 死循环 | 阶段合约修复，避免卡死或过早结束 |
| Tasks 1–8 合约主权 | 并入「阶段合约」或「录制可信度」 |

## 跨版本重复（已知）

**2026-09-06 ~ 09-18** 工作可能同时出现在：

- V1.2 小版本 6
- V2.0 小版本 0 ~ 1

汇报策略：

- V1.2 小版本 6 → 能力达标、质量门禁、引擎缺陷
- V2.0 小版本 1 → 产品管理验收、原子化转型
- 同指标只在一处写完整成效，另一处写「间接成效」或删条

## 维护说明表（可选文末）

```markdown
| 每双周 | V1.2 已冻结——只维护 **V2.0 小版本 N** |
|--------|----------------------------------------|
| 来源 | agent-log 收工 + 归档 + docs/report/ 日报 |
| 筛重 | V1.2 小版本 6 与 V2.0 小版本 0~1 重叠处合并删条 |
| 领导看 | 版本目标 → 编号列表 → **成效（估）** |
```

## 文件变更约定

- 更新 skill：改 `.cursor/skills/changelog-pm-requirements/`
- 更新活文档：仅用户要求时改根目录 `CHANGELOG.md`
- 不要主动改 `docs/report/`（用户本地 KPI 归档）
