---
name: changelog-pm-requirements
description: >-
  Rewrites product-facing CHANGELOG entries from agent-log, wet tests, and git
  evidence—not commit messages. Produces 小版本需求 with 版本目标, numbered
  requirements, and 成效（估） metrics for leadership reporting. Use when
  updating CHANGELOG.md, rewriting 小版本需求, 对外汇报, 产品需求归档, or
  reverse-engineering solved requirements from implementation.
---

# CHANGELOG 产品需求编写（PM 口径）

将技术交付反推为**产品经理/领导可读**的「本期已解决需求」，写入根目录 `CHANGELOG.md`（本仓库对外汇报文档，仅按用户要求更新）。

## 何时使用

- 用户要求重写某 **Release / 小版本** 的需求描述
- 从 `agent-log` / 湿测 / 评测反推「解决了什么业务问题」
- 为每条需求补 **成效（估）** 与可核对数据
- 用户要把编写方法沉淀为可复用 skill（可复制到 `~/.cursor/skills/`）

## 读者与语气

| 读者 | 关心什么 |
|------|----------|
| 产品经理 | 需求陈述、业务价值、是否可验收 |
| 领导 | 版本目标、量化成效、双周迭代节奏 |
| 研发（次要） | 仅保留必要术语；细节放 agent-log / git |

**禁止**：把 commit message、Task 编号、文件名、引擎内部类名当作「需求」主体。

**允许**：在 `成效（估）` 中引用 wet9、Acc@1、53/53 等**可核对结果**。

## 文档结构（固定）

```markdown
# 更新日志（CHANGELOG）

> 项目 / 用途 / 范围 / 排序：最新 Release / 小版本在前

**写法约定**（4~6 条 bullet）

---

## Release Vx.y（分支 · 起止说明）

### 小版本 N（YYYY-MM-DD ~ YYYY-MM-DD · 状态可选）

> **版本目标**：一句话——本双周要打通什么闭环 / 解决哪几类阻塞

**本期已解决需求**

1、**需求标题（须/应…）。**
需求描述 1~3 句：要解决什么问题、验收口径。
**成效（估）**：实测数据 + 对产品/业务的提升；无实测处合理估算并标「估」。

---

## 跨版本遗留（未写入「已解决」）

## 维护说明（可选）
```

**排序**：最新 Release 在最前；同一 Release 内小版本号**从大到小**。

## 单条需求模板（三条必含）

```markdown
N、**{标题：业务结果 + 须/应}。**
{描述：问题背景 + 要达成的行为/验收，不用 commit 语言。}
**成效（估）**：{实测指标}；{对产品的影响}；{估算提升，标注「估」}。
```

### 标题

- 用 **须/应** 表示已解决的需求（不是未来计划）
- 加粗整句标题：`**…**`
- 示例：`**产品管理模块须能稳定完成 AI 录制并保存可回放步骤。**`

### 描述

- 写「要解决什么问题」，不写「改了哪个文件」
- 可含 1 句验收口径（如：禁止零步假成功、须认业务 stamp）
- 未闭环的不写进「已解决」→ 放「跨版本遗留」

### 成效（估）

每条**必须有**。三层信息：

1. **实测**：agent-log / 湿测 / 评测中的数字（优先）
2. **业务价值**：对产品、测试效率、伙伴联调的含义（一句话）
3. **估算**：成功率、省时比例、失败率下降等——**必须标「估」**

| 数据来源 | 示例指标 |
|----------|----------|
| 湿测 | wet9 PASS、53/53 T4、6/6 draft-traj |
| KB 评测 | Acc@1 0.65→0.74、130 条基线 |
| 规模 | 30/30 模块、174 草稿、flows 29→82 |
| 清洗/门禁 | 24 条假成功清洗、verify-all 208/211 |
| 估算 | 成功率 40%→85%（估）、省时约 70%（估） |

**规则**：

- 有 log 数字 → 直接写，不加「估」
- 推断、对比、百分比降幅 → 加「估」
- 跨版本成果不要重复计（见下节）

## 编写工作流

### 1. 划定小版本日期与范围

- 读 `CHANGELOG.md` 该小版本现有条目（若有）
- 读 `docs/superpowers/agent-log.md` + 对应日期 `archive/logs/agent-log-archive-*.md`
- 可选：`docs/report/` 日报（gitignore，勿擅自改）

### 2. 归纳 8~12 条需求（合并技术碎项）

按**业务域**合并，常见分组：

- 录制可信度（假成功、门闩、失败可观测）
- 定位准确性（STC、搜索链、控件消歧、xpath）
- 知识库（导入、湿测、召回、加固、草稿质量）
- 原子化 / 伙伴推送（组件、坐标、V3、联调）
- 主链 / 贯通验证（T4、P6、跑车）
- 平台底座（菜单、BiB、安全、结构优化）

写 **版本目标** 时概括上述 2~3 个主题。

### 3. 产品经理粗需求 → 扩写

若用户提供 numbered 粗需求：

- 每条粗需求 → 1 条主需求（或拆成 2 条若验收点不同）
- 用 agent-log 补全未写明的配套能力（单独编号或并入「成效」）
- 不要丢原意；技术-only 项并入相关业务的「成效」

### 4. 写成效并去重

- 同一指标在相邻小版本只保留**一处**主归属
- 例：09-06~09-18 工作可在 V1.2 小版本 6 与 V2.0 小版本 1 重复——汇报时保留一版；文内用写法约定注明
- 「为下批定口径」类写**间接成效**，避免与下一小版本重复计数

### 5. 自检清单

- [ ] 每条有 **成效（估）**
- [ ] 无纯 commit / PR / 文件名需求
- [ ] 未闭环项不在「已解决」
- [ ] 版本目标与小版本条目主题一致
- [ ] 领导能读懂，研发细节已下沉
- [ ] 估算均标「估」

## 与本仓库的约定

- `CHANGELOG.md`：**用户指定**才更新（见 `docs/superpowers/todo-list.md`）
- 变更史以 **git commit message（中文）** 为准；CHANGELOG 是**对外汇报**层
- **v2.0.1+** 同事状态流转线：不在 CHANGELOG 登记（可放跨版本遗留一句）
- 不要重建已废止的 CHANGELOG 维护流程到 AGENTS.md

## 复制到个人 skill 仓库

```text
# 复制整个目录到个人 skills（跨项目复用）
cp -r .cursor/skills/changelog-pm-requirements ~/.cursor/skills/

# Windows PowerShell
Copy-Item -Recurse .cursor/skills/changelog-pm-requirements $env:USERPROFILE\.cursor\skills\
```

复制后可在其他项目使用同一 workflow；数据来源路径按该项目调整（agent-log、评测目录等）。

## 附加资源

- 完整示例（本仓库已重写小节）：[examples.md](examples.md)
- 指标来源与合并规则：[reference.md](reference.md)
- 活文档：`CHANGELOG.md`（全 Release / 小版本均已 PM 口径重写，含 **成效（估）**）
