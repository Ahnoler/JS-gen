# 分区数据改用 propertiesID/propertiesPID 父子树表达（Spec）

> 状态：待评审 → 实施（2026-08-24，3 天硬约束）
> 日期：2026-08-24
> 关联：830 任务③「推送到自动化」核心缺口；[[830-v3-batch-push-gap-analysis]]；[[830-partition-via-pid]]

---

## 1. 背景与问题

### 1.1 当前 V3 payload 树结构

`transcationProperties[]` 是一个扁平数组，靠 `propertiesID`（自身 id）和 `propertiesPID`（父 id）构成树：

```
page#1 (type=page, pid=0, 截图URL)
  └ ele#4 (type=ele, pid=1)  ← 只知道属于 page#1，不知道在哪个分区
  └ ele#5 (type=ele, pid=1)
page#2 (type=page, pid=0, 截图URL)
  └ ele#6 (type=ele, pid=2)
  └ ele#7 (type=ele, pid=2)
```

分区的详细信息（`main`/`table`/`shell-header`/`tab:客户基本信息`/`section:...`/`titlebox:...`）存在 `regionId`/`regionLabel` 字段中。

### 1.2 问题

`toPartnerImportPayload`（`partner-platform.js:147-171`）发送前**剥掉** `regionId`/`regionLabel`（伙伴 Jackson 拒绝未知字段）。已发送的 `.t33-sent-payload.json` 中这两个字段出现 **0 次**。

**后果**：消费方只看到 ele → page 的直接父子关系，无法知道 ele 在页面内的哪个分区。当同一页面存在两个同名控件（如两个"保存"按钮），消费方无法区分——**分区的歧义消解目标未达成**。

### 1.3 现有 region_id 链结构

`element_json.region_id` 是 `|` 分段的分层链，每段 `role:label`：

```
page:http://...#/home|shell-header                    → 1 层分区
page:http://...#/cstMgt/...|main                       → 1 层分区
page:http://...#/cstMgt/...|table                      → 1 层分区
page:url|tab:客户基本信息|section:对公客户概况|titlebox:法定代表人  → 3 层分区（嵌套）
```

`page:url` 是页面段（已有 page 截图条目承载），`|` 后面的段才是需要表达的分区层级。

---

## 2. 目标 / 非目标

**目标**

- 用现有的 `propertiesID`/`propertiesPID` 两个字段表达完整分区层级（tab/section/titlebox/card/main/table/…），**不加新字段**
- 消费方通过 propertiesID/propertiesPID 父子树即可重建分区层级，区分同页同名控件
- 发送体不再含 `regionId`/`regionLabel`（保持现有剥除逻辑，但现在它们是冗余的而非信息丢失）
- 与浏览器插件伙伴格式对齐（中间分区节点的 `type` 值需双方一致）

**非目标**

- 不改截图采集 / element_json 录入侧（region_id 链仍照常录制，仅在导出构建期重新编码进 PID 树）
- 不改页面级截图覆盖校验（`validatePageLevelCoverage` 仍校验 ele 能追溯到 page/dialog 截图条目）
- 不处理 v3-payload-size ① 精简传输（另刀）

---

## 3. 方案：插入中间分区节点

### 3.1 核心思路

在 `buildV3Properties` 构建期，为每个唯一的分区链段创建**中间节点**（`type: 'section'`），插入 page 与 ele 之间。树的层级变为：

```
page#1 (type=page, pid=0)
  └ section#N   (type=section, pid=1, propertiesName="顶栏")     ← shell-header
      └ ele#M   (type=ele, pid=N, propertiesName="点击客户管理")
      └ ele#M+1 (type=ele, pid=N, propertiesName="点击对公客户管理")
page#2 (type=page, pid=0)
  └ section#N+1 (type=section, pid=2, propertiesName="表格")     ← table
      └ ele#M+2 (type=ele, pid=N+1)
  └ section#N+2 (type=section, pid=2, propertiesName="主区")     ← main
      └ ele#M+3 (type=ele, pid=N+2, propertiesName="点击修改")
page#3 (type=page, pid=0)
  └ section#N+3 (type=section, pid=3, propertiesName="主区")
      └ section#N+4  (type=section, pid=N+3, propertiesName="客户基本信息")  ← tab:客户基本信息
          └ ele#M+4  (type=ele, pid=N+4)
```

嵌套分区链（`tab:...|section:...|titlebox:...`）产生嵌套 section 节点，逐层 pid 指向父 section。

### 3.2 分区节点字段约定

| 字段 | 值 | 说明 |
|------|-----|------|
| `propertiesID` | 顺序号（续截图条目之后） | 与 page/ele 同一编号空间 |
| `propertiesPID` | 父节点 id（page 或父 section） | 根分区 → page id；嵌套子分区 → 父 section id |
| `type` | `'section'` | **新增 type 值**（非新增字段）；消费方按可选值处理 |
| `propertiesName` | 分区显示名 | 取 `region_label`；无则取 region_id 段的 label 部分（`role:label` → label） |
| `realLabel` | 分区 label 原值 | 同 propertiesName 来源，供消费方显示 |
| `screenshot` | `[]` | 分区节点无截图 |
| `rect` | `''`（空） | 分区节点无坐标 |
| `elementType`/`eventTypeValue`/`eventTypeName`/`mothed`/`options`/`objectValue`/`transcationType` | 空 / 默认 | 分区节点非操作步骤 |

### 3.3 ID 编号顺序

```
1..A   → page/dialog 截图条目（type=page/dialog，screenshot 非空）
A+1..B → section 分区节点（type=section，screenshot 空）
B+1..C → ele 控件步骤条目（type=ele，screenshot 空）
```

截图条目在前（保持现有顺序），分区节点居中，ele 在后。分区节点按**首次出现顺序**编号。

### 3.4 构建流程（`buildV3Properties` 改造）

```
1. 遍历 traj.steps，解析每个 step 的 element_json.region_id 链
2. 对每个 step，提取 page 段后的分区段列表：segments = region_id.split('|').slice(1)
   例：page:url|tab:客户基本信息|section:概况 → segments = ['tab:客户基本信息', 'section:概况']
3. 维护 sectionCache: Map<partitionKey, entryId>，partitionKey = pageId + '|' + 段路径累计
4. 逐段创建/复用 section 节点：
   for (i, seg) in segments:
       parent = (i==0) ? pageEntryId : prevSectionId
       key = pageEntryId + '|' + segments.slice(0,i+1).join('|')
       if sectionCache has key → reuse
       else → create section node, id=nextId++, pid=parent, sectionCache.set(key, id)
       prevSectionId = sectionCache[key]
5. ele 节点的 pid = 最后一个 section 的 id（无分区段则 pid = page 截图 id，保持原逻辑）
```

### 3.5 发送侧（`toPartnerImportPayload`）

- `regionId`/`regionLabel` 继续剥除（现在冗余，树已表达分区）
- `type: 'section'` 的条目**全量保留**（它是已知字段 `type` 的一个新值，不是新字段）
- 其余逻辑不变

### 3.6 覆盖校验适配（`validatePageLevelCoverage`）

- `shotIds` 仍只含 `type === 'page' || type === 'dialog'` 的条目
- ele 的 `propertiesPID` 现在指向 section 节点而非 page——需要**向上追溯** pid 链直到找到 page/dialog 条目
- 新增 `resolveRootScreenshotId(prop, propsById)`：沿 pid 链上溯，返回最近的 page/dialog 条目 id
- isLocatable / exempt 逻辑不变

---

## 4. type='section' 契约风险与对策

| 风险 | 对策 |
|------|------|
| 伙伴 Java DTO 的 `type` 是枚举，不接受 'section' | **D2 湿测首推即验**：推送一条含 section 节点的交易，看伙伴返回 200/400。若 400 → fallback：section 节点改用 `type: 'ele'` + `elementType: 'partition'`（消费方按 elementType 区分分区容器与控件），仍不加新字段 |
| 浏览器插件伙伴格式对齐 | section 节点结构（type/propertiesName/propertiesPID 约定）写入 CHANGELOG Python 同步提示 + api-docs，供伙伴对齐 |
| 分区节点增加条目数，payload 变大 | 分区节点是轻量条目（无截图/无 rect/无 action 字段），增量 ≤ 唯一分区数（通常 <20），可忽略 |

---

## 5. 存量兼容

- 存量数据（无 section 节点的旧 V3 payload）仍可正常推送：ele 直接 pid → page，消费方向上追溯 pid 链找到 page 即可
- `coverageMode` 逻辑不变：`page_level`（新录制，含 section 节点）/ `legacy_phase_fallback`（存量）
- `validatePageLevelCoverage` 向上追溯对旧数据天然兼容（pid 直指 page，一步到位）

---

## 6. 验收

1. **characterization**（`characterize-export-v3-pid.mjs` 新增）：
   - 分区节点创建：单层（main/table/shell-header）→ 1 个 section；嵌套（tab|section|titlebox）→ 3 个嵌套 section
   - ele pid 指向最近 section；无分区段的 ele pid 指向 page（原逻辑）
   - sectionCache 复用：同页同分区下多个 ele 共享 1 个 section 节点
   - 同页同名 ele（如两个"保存"）落在不同 section 下 → pid 不同 → 可区分
   - 覆盖校验：ele pid→section→page 向上追溯命中 page 截图
   - 回归：现有 V3 断言（截图合并/rect 字符串/screenCapture）不动
2. **湿测**：推送一条含 section 节点的交易到伙伴平台（172.20.101.63:11002），验证 200 且 section 条目被接受；若 400 按 §4 fallback
3. **verify-all.sh** ALL GREEN

---

## 7. 实施文件清单

| 文件 | 改动 |
|------|------|
| `src/services/transaction-export-v3.js` | `buildV3Properties`：分区节点创建 + sectionCache + ele pid 改指向 section；`validatePageLevelCoverage`：向上追溯 pid 链 |
| `src/services/partner-platform.js` | 无改（regionId/regionLabel 已在剥除名单；section 条目全量保留） |
| `scripts/characterization/characterize-export-v3-pid.mjs` | 新增 characterization |
| `scripts/refactor/verify-all.sh` | 注册新 characterization |
| `src/dashboard/api-docs/groups/export-mgmt.js` | api-docs 补 type='section' 说明 |
| `CHANGELOG.md` | [Unreleased] Changed 追加条目 |
