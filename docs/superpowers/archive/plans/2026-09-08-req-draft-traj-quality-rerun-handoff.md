# 复测移交：req→draft-traj 原子草稿质量修复后重跑（product-mgmt）

> **给执行 Agent（Zcode）**：上一轮湿测 DoD 6/6 只证明了 API 通路；Lead 质量审发现章节挂错 + task 来源占位未替换。本轮 **只复跑 product-mgmt 的 propose→人工核对→commit**，验证修复是否生效。  
> **作者**：Cursor Reviewer（2026-09-08）  
> **前置修复**：`src/services/req-draft-traj/provenance.js` + `propose.js`（多 ZJJK 解析、占位 ZJJK 忽略、概述/复用降权、`<sourceDoc>`/`<sourceChapter>` 替换）  
> **离线门闩**：`node scripts/characterization/characterize-req-draft-traj.mjs` → 期望 **OK 25**（原 19）

---

## 0. 为何重跑

| 上一轮问题 | 修复意图 |
|------------|----------|
| 「同层排序」「启用」挂到 `01-总体概述` | 占位 ZJJK（`—`/`主页`）不再当码；hint 分片 + 概述降权 → 应挂 `03-配置产品信息` |
| 「公共要素」挂到 `06-查询产品` | 多码单元格 `ZJJK00136564 / …` 提取首码；复用提及降权 → 应挂 `03` |
| 个性化要素 `missing_source_chapter` | 多码可解析后应能进 `atoms`（若仍 reject，写明 reason） |
| task 正文残留 `<sourceDoc>` / `<sourceChapter>` | propose materialize 时替换为真实值 |

离线自检（不调 LLM）已对 chain-a 10 步 `resolveChapterRef`：**步 5/7/8/9 均指向 `03-配置产品信息`**。本移交要验证 **LLM propose 路径** 同样正确。

---

## 1. 禁区（与上一轮相同）

- **不要** prepare / record/start / detach（不占执行机）
- **不要** 重切全库需求文档；**不要** 清/重录 R1–R6 / #614
- **不要** 改轨迹查询 WIP 四文件、`session_runner`、主链引擎
- 旧草稿 **681/682** 可保留作对照；本轮 commit 用 **新 atomKeys 或 `force:true`**，避免只测 duplicate skip

---

## 2. 前置

```bash
# 控制面须已加载本轮代码（若仍跑旧进程 → 重启 4097）
node scripts/characterization/characterize-req-draft-traj.mjs
# 期望：OK 25
```

---

## 3. 步骤

### 3.1 重新 propose（刷新 cache）

```http
POST /api/v2/kb/req-modules/product-mgmt/draft-traj/propose
Content-Type: application/json

{ "maxAtoms": 12, "chainIds": ["chain-a"] }
```

Windows：**body 落 UTF-8 文件**，用 `--data-binary @file`（勿 Git Bash 内联中文 JSON）。

证据落盘：`tmp/req-draft-traj/quality-rerun-propose.json`

### 3.2 人工质量清单（写入报告，逐条勾）

对 **每一个** `atoms[]` 项：

- [ ] `sourceChapter` **不得** 为 `chapters/01-总体概述.md…`（排序/启用/公共要素尤甚）
- [ ] 公共要素 / 基本信息 / 新增* / 启用 / 禁用 → 期望含 `03-配置产品信息`（或可解释的同模块操作章，**禁止**概述章）
- [ ] `taskDraft` **不含** 字面量 `<sourceDoc>` / `<sourceChapter>`；「来源：」行已是真实路径
- [ ] `suggestedFunctionId` 为 `null` 或真实存在的 `system.id`（不应再出现 11 位幻觉码进 commit 撞 FK；若非 null 应用 override 或接受 null+override）
- [ ] 粒度仍偏原子（无「建库→启用」一锅端）

`rejected`：记录 atomKey + reason。个性化要素若已进 `atoms` 记为改善；若仍 reject 贴 reason。

### 3.3 Commit（勾 2～3 条，含至少 1 条上一轮章节易错的）

优先勾选：

1. `…:5:同层节点排序`（或同义 title）— 上一轮章节错
2. `…:7:公共要素配置保存` — 上一轮章节错  
3. （可选）`…:9:启用产品` 或个性化若已可选

```http
POST /api/v2/kb/req-modules/product-mgmt/draft-traj/commit
Content-Type: application/json

{
  "atomKeys": ["<paste>", "<paste>"],
  "systemAccountId": 2,
  "functionIdOverrides": {
    "<atomKey>": 9000000740
  },
  "force": true
}
```

`force:true`：避免与 681/682 同 key 只走 duplicate。证据：`tmp/req-draft-traj/quality-rerun-commit.json`

### 3.4 GET 核对

对每个 `created.trajectoryId`：

- `recordStatus=draft`
- provenance 四字段非空
- **`task` 正文无占位符**
- `reqChapterRef` 符合 §3.2（非概述）

---

## 4. 报告模板

落到 `tmp/req-draft-traj/through-report-quality-rerun.md`：

```markdown
# req→draft-traj 质量复测

- 时刻 / 控制面是否重启加载新代码
- characterize：OK __
- propose：atoms=N rejected=M；章节抽查表（atomKey → sourceChapter）
- 占位符：有/无残留
- commit：trajectoryId 列表；GET 摘录
- 结论：PASS / FAIL（FAIL 须贴失败 atom 原文）
- 遗留
```

---

## 5. DoD（本轮）

1. characterize **OK 25**
2. propose 刷新 cache；**无** `01-总体概述` 挂在写操作原子上（抽查排序/启用/公共要素）
3. 全量 atoms 的 `taskDraft` **无** `<sourceDoc>`/`<sourceChapter>` 字面量
4. commit ≥2 条 draft（建议含排序或公共要素）+ GET 验证
5. 全程无 record/prepare
6. 报告落盘 + agent-log 收工

---

## 6. FAIL 时

停。把 propose JSON + 失败 atom 贴回 Lead。**不要**为过 DoD 手改 `.draft-traj-propose.json` 后假装 propose 成功。
