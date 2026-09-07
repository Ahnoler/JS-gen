# AI/JSON 菜单落地 pageId：天元场景编号回退 + 推送含 ai

> 状态：已评审（2026-09-02）  
> 日期：2026-09-02  
> 范围：录制 prepare 读天元编码回写 `pd_cmpt_ecd`；菜单推送确认含 `source=ai`  
> 关联：`docs/superpowers/specs/2026-08-31-menu-landing-pageid-design.md`、`docs/superpowers/specs/2026-09-01-menu-push-d1-d2-design.md`

## 1. 背景

推送菜单需求新增两点：

1. **来源为 `ai` 的菜单也需要推送**（扫描补齐的模块/功能）。
2. **`source=ai` 的二级菜单在录制过程中补抓落地编码**：有「组件编号」用组件编号，没有则用「场景编号」。现状 AI 二级菜单扫描新建时不写 `pd_cmpt_ecd`，推送时 `pageId` 常为空。

天元「相关配置」弹窗字段（真机截图确认）：

| 字段 | 示例 | 用途 |
|------|------|------|
| 组件编号 | `ZJJK00066153`（单码）或长文案含多个括号码 | 优先落地 pageId |
| 场景编号 | `FS00005518` | 无有效组件编号时回退 |

## 2. 已拍板决策

| 项 | 决策 |
|----|------|
| 推送过滤 | **不按 source 过滤**；系统下 type=2\|3 全量推送（含 `ai`）。现有 `menu-push.js` 已满足，本期不改过滤逻辑。 |
| 回写范围 | 仅功能节点（type=3）且 `source ∈ {json_import, ai}` |
| 组件编号有效条件 | 「组件编号：」后整行匹配 `^[A-Za-z0-9]+$` 才算有；长文案/多括号 → 视为无 |
| 落地 pageId 优先级 | ① 有效组件编号 → ② 场景编号（`FS…`）→ ③ AILZ（仅写交易，不回写菜单） |
| 场景编号来源 | **仅天元弹窗**「场景编号：」行；不用 URL `fcnScnEcd` 作第三兜底 |

## 3. 非目标

- 菜单扫描阶段写 `pd_cmpt_ecd`
- `manual` / 空 `source` 节点回写
- URL query `fcnScnEcd` 兜底
- 改伙伴 `importData` 字段契约
- 批量回刷历史已推送菜单 / 历史 `trajectory.page_id`
- 修改推送状态机 / partner HTTP

## 4. 取值与回写规则

```
读天元弹窗
  ├─ componentCode = 整行单码 ? 该码 : ""
  ├─ scenarioCode  = 匹配「场景编号：」后的 FS…（否则 ""）
  └─ landingId     = componentCode || scenarioCode || ""

落库
  ├─ trajectory.page_id = landingId || AILZ…
  └─ 若 landingId 非空 且 功能节点 source ∈ {json_import, ai}
       → 回写 system.pd_cmpt_ecd + system_page 单行（现有 writeBackFunctionLandingPage）
     否则不碰菜单
```

与 2026-08-31 设计差异：

| 项 | 2026-08-31 | 本期 |
|----|------------|------|
| 读源 | 仅组件编号 | 组件编号 + 场景编号 |
| 回写门禁 | `source=read`（读成功） | 读成功（有 landingId）且节点 `source ∈ {json_import, ai}` |
| AILZ | 不回写菜单 | 不变 |

说明：旧文档用 `source=read` 指「读组件成功」的绑定结果标志；本期落地码来自组件或场景，绑定结果仍可标为 `read`（相对 AILZ 的 `generated`），但回写另加**菜单节点来源**白名单。

## 5. 推送侧

- `buildMenuPushPayload`：`pageId` = 功能节点 `pd_cmpt_ecd`（可能是 `ZJJK…` 或 `FS…`）
- `source=ai` 节点已在全量 menus 中；录制回写后推送可带非空 `pageId`
- 本期不改 `menu-push` 过滤；若特征化未 pin「含 ai」，可补一条断言（可选）

## 6. 实现触点

| 文件 | 变更 |
|------|------|
| `scripts/controller/actions/js_snippets/page_id.py` | 解析场景编号；组件编号仅单码时填入；返回 `scenarioCode` |
| `scripts/controller/actions/_replay.py` | 确认 `pageCode` 透传 `scenarioCode`（若对象整挂则可能无改） |
| `src/services/trajectory/recording-page-bind.js` | landing = component \|\| scenario \|\| AILZ；回写前查节点 source 白名单 |
| `scripts/characterization/characterize-page-bind.mjs` | pin 场景回退、长文案无效、仅 json_import/ai 回写 |
| `CHANGELOG.md` | `[Unreleased]` |

## 7. 验证

- `node scripts/characterization/characterize-page-bind.mjs`
- （可选湿测）无组件编号、仅有场景编号的 AI 功能菜单：prepare → `pd_cmpt_ecd=FS…` → push-menu 报文 `pageId` 非空

## 8. 风险

- 部分页面天元弹窗字段布局不同，场景编号正则需与「组件编号」同样容忍空白；失败则退 AILZ，不阻断录制
- 同一功能先 JSON 导入后被扫描改名等：回写仍以当前节点 `source` 为准
