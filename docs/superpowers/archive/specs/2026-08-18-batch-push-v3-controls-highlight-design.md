# 批量推送 V3.0 · 阶段长图控件点亮（对齐同事 groups 约定）设计

日期：2026-08-18 · 状态：设计稿 v2（对齐消费方约定）

## 背景与目标

产品需求：用户查看交易轨迹时，在**阶段长图**上展示本次交易**操作过的控件**，
**可任意勾选点亮**（勾选三个控件，长图上只亮这三个）。

V2.0 不满足：`phases[].metadata` 携带截图全量可见元素（traj 38 phase 3 达 183 个），
数据量大且前端需自行匹配"哪些是操作过的"。

**V3.0 目标**：对齐**消费方约定格式**（同事第一版 `result` 结构：`groups[]` 树，
混合组节点 page/dialog + 控件节点 ele，`pid` 关联；弹窗组 `key` 带
`@@anchor=<触发按钮xpath>`），在此基础上**补控件坐标 + 阶段长图**，即可完成任意点亮。

**已确认决策**：
1. V3.0 输出按同事约定做第一版（`groups` 结构）；格式可协商，但消费方尽量少变。
2. `transcationProperties` **保留**（= 控件组：本次交易轨迹触发的所有控件，V2.0 同款）。
3. **弹窗视为另一个页面**（由按钮触发）：未来弹窗独立截图（`dialog` 组 `screenshots` 有内容）；
   **第一版**弹窗控件坐标相对**阶段长图**（弹窗画面已含在长图内），dialog 组 screenshots 留空。

## 接口

新增 3 个端点（V2.0 保留不变）：

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/api/v2/export/trajectories/:id/transaction-v3` | 组装（dry-run，返回 envelope） |
| POST | `/api/v2/export/trajectories/:id/transaction-v3` | 组装/推送 |
| POST | `/api/v2/export/transactions-v3` | 批量（body 同 V2.0） |

Envelope 与 V2.0 一致：`payload.transcationEventTypeList[]` + count/skipped/stats。
**entry 新增 `result` 字段**（groups 结果格式）；其余字段（transcId/transcationName/
systemId/projectId/transcationType/testFrame/transcationProperties）保持。

## 数据形态（entry）

```jsonc
{
  "transcId": "38",
  "transcationName": "信贷潜在客户转正",
  "systemId": "...", "projectId": "...",
  "transcationType": "web", "testFrame": "playwright",
  "transcationProperties": [ /* V2.0 同款，保留：本次交易触发的所有控件 */ ],
  "result": {                       // V3.0 新增：对齐同事 groups 约定
    "id": "traj-38",
    "name": "信贷潜在客户转正",
    "url": "http://test.creditv5p2...",   // 交易入口 URL（首个 go_to_url 或留空）
    "groups": [
      // ① 页面组：一张长图 = 一个页面组（当前每阶段一张长图）；组间平级（非父子）
      {
        "id": "page-3", "pid": null, "type": "page",
        "key": "page-3", "name": "页面3 · 填写信贷正式客户基本信息",
        "screenshots": [{           // 该页面长图（前端按图片自然尺寸计算缩放）
          "phaseNumber": 3,
          "url": "/api/v2/screenshots/8734/image"
        }]
      },
      {                             // ② 页面控件（type: ele）
        "id": "step-17",            // 稳定标识：phase 内步骤号（勾选/点亮用）
        "command": "input", "action": "fill_form_field",
        "target": "//div[@label='客户编号']...",   // element_json.xpath_smart
        "targetType": "xpath",
        "tagName": "input", "kind": "input",
        "propertiesName": "客户编号", "label": "客户编号",
        "placeholder": "", "title": "", "value": "",
        "disabled": false, "required": false, "readonly": false,
        "type": "ele", "group": [], "options": [],
        "timestamp": 1786961742022, "scanIndex": 0,
        "recorded": true, "manualRecord": false,
        "pid": "page-3",
        "params": { "label_text": "客户编号", "value": "..." },
        "rect": { "x1": 29, "y1": 1997, "x2": 336, "y2": 2029 }   // 新增：内容坐标
      },
      {                             // ③ 弹窗组（弹窗 = 另一个页面，附属于触发按钮）
        "id": "page-3|dialog:地址选择器@@anchor=//button[normalize-space()='选择']",
        "pid": "page-3", "type": "dialog", "key": "同上", "name": "地址选择器",
        "screenshots": []           // 第一版留空（长图已含弹窗画面）；未来弹窗独立截图
      },
      {                             // ④ 弹窗内控件
        "id": "step-22",
        "command": "select", "action": "select_option",
        "target": "//div[contains(@class,'el-dialog__wrapper')]...",
        "targetType": "xpath", "tagName": "input", "kind": "select",
        "propertiesName": "省份", "label": "省份",
        "placeholder": "请选择", "title": "", "value": "福建省",
        "disabled": false, "required": false, "readonly": true,
        "type": "ele",
        "group": [{ "type": "dialog", "name": "地址选择器", "key": "同上" }],
        "options": [],
        "timestamp": ..., "scanIndex": ...,
        "recorded": true, "manualRecord": false,
        "pid": "page-3|dialog:地址选择器@@anchor=//button[normalize-space()='选择']",
        "anchorTarget": "//button[normalize-space()='选择']",       // 触发按钮 xpath
        "anchorPropertiesName": "登记注册地址 选择",                  // 触发按钮名
        "params": { "label_text": "省份", "value": "福建省" },
        "rect": { "x1": ..., "y1": ..., "x2": ..., "y2": ... }      // 相对本阶段长图
      }
      // 阶段 1/2 同理：各自 page 组（平级）+ 控件 + 弹窗
    ]
  }
}
```

## 构建规则（从步骤 element_json 构建 groups 树）

### 组节点（分层）

- **页面组**：**一张长图 = 一个页面组**（当前每阶段一张长图，故每阶段一个页面组；
  未来一阶段多张长图时页面组数 = 长图数）。组间**平级**（页面之间不是父子关系）：
  - `id`/`key` = `page-<phaseNumber>`（长图序号即阶段号，当前一一对应）；
  - `name` = `页面<n> · <阶段描述前 20 字>`；
  - `pid` = null；`screenshots[0]` = 该页面长图（`{phaseNumber, url}`，**无尺寸字段**——
    前端按图片自然尺寸计算缩放）。
- **弹窗组**：**归属判定 = `element_json.region_id` 分层链含 `overlay:` 段**
  （`assignRegion` 对 `.el-dialog/.el-drawer/.el-message-box` 内元素返回
  `region_role: 'overlay'`，region_id 形如 `overlay:地址选择器`）——含则属弹窗，否则属页面。
  - `name` = 弹窗标题（overlay 段 label）；
  - `key`/`id` = `page-<n>|dialog:<标题>@@anchor=<触发按钮xpath>`；
  - **触发按钮（anchor）推断**：按步骤顺序，弹窗区操作的前置最近一个
    `click_*`/button 步骤（其 element_json.region 不含该弹窗 overlay 段）作为 anchor——
    `anchorTarget` = 该按钮步骤的 `xpath_smart`，`anchorPropertiesName` = 其
    `formLabel || text`；推断不到则省略 anchor 字段（key 不带 `@@anchor`）。
- 组顺序：按阶段号升序；阶段内按首次出现顺序；控件按步骤顺序排在所属组之后。

### 控件节点（每步一条）

| 字段 | 来源 |
|------|------|
| id | `step-<stepNumber>`（phase 内步骤号；稳定、可读；消费方可自行换 uuid） |
| command/action | action_type 映射（fill_form_field→input、select_option→select、fill_date_field→date、click_*→click 等；未映射保留原名） |
| target/targetType | `xpath_smart`（缺则 xpath_full）/ `xpath` |
| tagName/kind | `tag` / `target_kind`（kind 映射：form_input→input、form_select→select、form_date→date、form_tree_select→tree、button→button、menu→menu、form_radio→radio、form_checkbox→checkbox、table_row_button→button） |
| propertiesName/label | `formLabel || text || matchedLabel` |
| value | params.value（有则填；无则空串） |
| placeholder/title/disabled/required/readonly | element_json.attributes 有则填，无则默认（""/false） |
| group | 弹窗内控件：`[{type:'dialog', name, key}]`（与弹窗组一致）；否则 `[]` |
| params | 步骤 params_json（label_text/value 等） |
| pid | `page-<n>`（页面控件）或弹窗组 id（弹窗内控件）——由 pid 链决定所属阶段，**控件无 phaseNumber 字段** |
| rect | `element_json.bbox` 合法（四值有限且 x2>x1、y2>y1）时输出；无则**省略**（不参与点亮），计入 stats |

### screenshots（页面长图）

每个页面组 `screenshots[]` 一条：`{phaseNumber, url: '/api/v2/screenshots/<id>/image'}`
（取 kind=phase_highlight 截图，按阶段）。**无尺寸字段**——前端按图片自然尺寸计算缩放。
弹窗组第一版 `screenshots: []`（未来弹窗独立截图后填充）。

### transcationProperties（保留）

V2.0 同款（`mapStepToTransactionEvent`），语义 = 本次交易触发的所有控件（控件组）。

## 实现

- 新服务 `src/services/transaction-export-v3.js`：
  - `buildGroupsResult(traj, phases, phaseScreenshots)` → result 对象（groups 树）；
  - `buildTransactionEntryV3` / `buildTransactionPayloadV3` / `wrapTransactionListV3`；
  - 复用：`mapStepToTransactionEvent`（transcationProperties）、`deriveRegionRef`。
- 路由 `src/routes/v2/export-mgmt.js` 追加 3 个端点（复用文件内 helper：
  parseIdList/parseBool/resolveSystemProject/maybePushSingle/assertPushableForPartner）。
- `src/dashboard/api-docs/groups/export-mgmt.js` 登记 3 端点。
- `CHANGELOG.md` `[Unreleased]` 条目（路由 + 服务，含 Python 同步提示）。

## 验证

1. `GET /api/v2/export/trajectories/38/transaction-v3`（dry-run）：
   - `result.groups` 含各阶段 `page-<n>` 页面组（平级）+ 控件 + 弹窗组（若该阶段有弹窗操作）；
   - 控件 `rect` 与 DB `element_json.bbox` 逐一相等（抽 5 个）；
   - 控件 `pid` 归属正确（弹窗控件挂对应页面弹窗组，页面控件挂 `page-<n>`）；
   - 各 `page-<n>.screenshots` 含该阶段长图（`{phaseNumber, url}`，无尺寸字段）；
   - `transcationProperties` 与 V2.0 输出一致。
2. 前端点亮验证：临时 HTML 读 result.groups 渲染（长图 + rect 画框 + 勾选子集），
   9242 浏览器核对框与真实控件位置对齐、任意勾选只亮勾选项。
3. characterization `scripts/characterization/characterize-export-v3.mjs`：
   纯函数断言（组树构建/弹窗 anchor 推断/rect 过滤/kind 映射/字段默认值）+
   真实数据断言（traj 38）→ 注册 `verify-all.sh`。
4. `verify-all.sh` 全绿；V2.0 端点回归正常。

## 不在范围

- 前端勾选交互 UI（外部 Vue 仓库）。
- **弹窗独立截图**（未来：dialog 组 screenshots 有内容，弹窗控件 rect 相对弹窗截图；
  第一版不做，弹窗控件 rect 相对阶段长图）。
- 无坐标步骤回填（第一版省略 rect；统计计入 stats）。
