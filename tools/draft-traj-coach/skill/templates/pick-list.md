# 建议勾选清单 — {{MODULE_KEY}}

> 质量标准：`references/taskdraft-quality.md`（闸门通过 ≠ 达标）。  
> **编排者确认后**操作员才可 validate/commit。默认只应从「建议勾选」勾选。

## 建议勾选（near_gold · 金样五条大致满足）

| 确认 | atomKey | title | kind | quality | flags | suggestedFunctionId | 备注 |
|------|---------|-------|------|---------|-------|---------------------|------|
| ☐ | | | | near_gold | | | |

## 建议暂缓（thin · 勿默认 commit）

| atomKey | title | flags | 未过金样条（G1–G5） |
|---------|-------|-------|---------------------|
| | | thin_one_liner,no_locate,… | |

## rejected 摘要（闸门未过）

| atomKey | reason | 处置建议 |
|---------|--------|----------|
| | | 拆链 / 查章节 / … |

## 编排者回填（二选一）

### A. 勾选表

将「建议勾选」中「确认」改为 ☑ 的行视为批准。若勾选了暂缓行，视为覆盖质量建议。

### B. JSON

```json
{
  "atomKeys": [],
  "functionIdOverrides": {},
  "flowRefOverrides": {},
  "force": false,
  "overrideThinQuality": false
}
```
