# 语料到原子组件草稿

> **状态**：待评审。用户选定范围 A（2026-09-22）：插件数据格式尚未确定，本文件不冻结插件载荷。
> **用途**：把测试人员采集来的原始载荷收进控制面，适配成内部规范步骤，清洗后沉淀为 `operation_component` 草稿。确认仍走现有接口。召回、组合回放、按组件推伙伴不在本文。

## 1. 结论

插件与控制面之间只约定一个信封：`client`（`名称/版本`）和 `payload`（任意 JSON 对象）。`payload` 的字段、事件名、定位快照由同事的插件版本自己定义。控制面按 `client` 选择适配器；没有适配器就只落原始载荷，不清洗、不沉淀。

适配器产出内部规范步骤。清洗、切段、签名、草稿都只读规范步骤。签名函数继续用 `computePhaseSignature`（`src/services/operation-component-signature.js`）。同一 `(system_id, signature)` 已有组件时只追加语料证据，不改 `name` / `steps_json` / `signature`。

语料不写入 `trajectory`、`trajectory_phase`、`trajectory_step`，也不写入 `operation_component_occurrence`。出现次数表的 `trajectory_id` 与 `trajectory_phase_id` 都是 NOT NULL（`migrations/20260806120000_operation_component.js`），语料没有阶段行，不能塞进这张表。证据走新表。

新签名要来自至少两个不同批次，才创建 `status=draft`、`component_type=normal` 的组件。不自动 `confirm`。不从语料生成可回放交易。

## 2. 范围

**本文交付（实现时）：**

- `POST/GET /api/v2/telemetry/batches` 与 `POST /api/v2/telemetry/batches/:id/adapt`
- 原始批次、规范会话、规范步骤、页面段、主机绑定、语料证据六张新表
- `operation_component` 增加 `origin`、`telemetry_evidence_count`
- 纯函数：折叠、切段、签名、敏感键剔除、沉淀判定
- 只读审查稿 `tmp/telemetry-component-review.md`
- 一条 characterization，登记进 `scripts/refactor/verify-all.sh`

**不在本文：**

- 浏览器插件的实现、权限、交互、以及 `payload` 内部字段
- 流程卡写回、定位先验、路径先验、召回评测集
- 录制期召回组件、组合回放、伙伴推送改单位
- `special_element`、登录/登出组件的注册与回放
- 把语料步骤标成成功或失败。观测不到就保持「未观测」，不记成成功

同事设计稿（2026-09-22 语料采集）里的片段 JSON、判别器全表、流程卡字段映射，只在附录作对照。附录不是契约。插件字段一变，只改对应版本的适配器。

## 3. 格式未定下的三条做法

| 做法 | 结果 |
|---|---|
| 按同事设计稿第 5 节把片段 JSON 写成接口 | 格式一改，落库、清洗、沉淀一起返工 |
| 等插件格式冻结再写规格 | 内部规范形、证据表和「不得生成轨迹」没有文字可对 |
| **信封 + 版本适配器 + 内部规范形（采用）** | 现在能定的是控制面；插件只通过适配器进入 |

采用第三条。内部规范形在本文写死。插件载荷不写死。

## 4. 线缆契约

`POST /api/v2/telemetry/batches`，鉴权沿用 `/api/v2` 的 `ssoAuth`。插件如何取令牌不在本文。

请求体只有两个字段：

| 字段 | 规则 |
|---|---|
| `client` | `名称/版本`。名称与版本各 1..32 字符，字符集 `[A-Za-z0-9._-]`，中间恰好一个 `/` |
| `payload` | JSON 对象。不是数组，不是 `null`，不是字符串 |

除此之外的请求体字段忽略，不报错。`payload` 序列化后超过 8 MiB，返回 413。`client` 或 `payload` 不合格，返回 400，不落库。

幂等键：

- 请求头 `Idempotency-Key`：1..128 个可见 ASCII，不含空格。有则用之。
- 没有该头：对 UTF-8 字节 `client + "\n" + 稳定 JSON(payload)` 取 SHA-256 十六进制。稳定 JSON 指对象键递归排序，数组保持原顺序。
- 同一幂等键且正文哈希相同：返回已有批次，不重新适配。
- 同一幂等键且正文哈希不同：409，不覆盖旧载荷。

响应 `data`：`{ id, adaptStatus, idempotencyKey }`。`adaptStatus` 见第 6 节。

`GET /api/v2/telemetry/batches/:id` 返回批次状态、`client`、适配错误、会话数、已沉淀段数。不返回 `payload`。

`POST /api/v2/telemetry/batches/:id/adapt` 按当前部署的适配器重跑该批次。语义见第 10 节。

原始 `payload` 不写入应用日志。

## 5. 内部规范形

适配器把一个批次拆成零个或多个会话。每个会话是有序步骤列表。控制面不猜测 `payload` 里哪里是会话边界；拆不开就返回一个会话，或返回空列表。

**会话**

| 字段 | 必须 | 说明 |
|---|---|---|
| `sutHost` | 否 | 字符串或 `null`。用来查系统绑定 |
| `operatorRef` | 否 | 长度 ≤64，或 `null`。只用于审查稿计数，不参与去重 |
| `steps` | 是 | 数组，可为空 |

**步骤**

| 字段 | 必须 | 说明 |
|---|---|---|
| `stepNumber` | 是 | 会话内从 1 递增的整数 |
| `eventClass` | 是 | `action` \| `noise` \| `unknown` |
| `actionType` | `action` 时必须 | 现有产品动作名，如 `fill_form_field`、`click_button`。`noise` / `unknown` 为 `null` |
| `params` | 是 | 对象或 `null`。签名只使用其中已有的稳定语义键（`label_text` 等），规则不改 |
| `element` | 是 | 对象或 `null`。可含 `formLabel`、`placeholder`、`xpath_smart`、`xpath_full` |
| `feedbackObserved` | 是 | 布尔。`false` 表示适配器未能判断有没有系统反馈 |
| `feedback` | 是 | `feedbackObserved=true` 时为数组，元素 `{ level, text }`，`level` 为 `error` \| `warning` \| `info`。未观测时为 `null` |
| `pageLevelKey` | 是 | 字符串或 `null` |
| `noEffect` | 是 | `null` 或 `disabled` |
| `ts` | 否 | epoch 毫秒或 `null`。不参与签名 |

适配器约定（每个已注册版本都要满足，由该版本的测试钉住）：

- 看过页面并且没有 toast、校验红字、对话框错误时，`feedbackObserved=true` 且 `feedback=[]`。
- 没看、或这一版插件根本不送反馈时，`feedbackObserved=false` 且 `feedback=null`。禁止把「没看」写成空数组。
- 不把用户刚输入的自由文本抄进 `params`。枚举选项文案可以留在现有签名会读取的键上。
- 不产出 `component_type=login/logout`。登录步骤若被收进来，也只可能变成普通草稿，由人废弃。

控制面在写入规范步骤前，从 `params` 与 `element` 递归删除下列键（大小写不敏感）：`password`、`passwd`、`token`、`cookie`、`authorization`、`secret`、`sessionid`。删除记入批次的 `adaptWarning`，适配仍算成功。控制面不做除此之外的脱敏：载荷结构未定，无法判断哪个字符串是姓名或金额。原始载荷仍可能含这些内容，靠第 10 节的保留期丢掉。

## 6. 存储

与轨迹三表并列。语料层只追加和标记过期，没有编辑接口。

**`telemetry_batch`**

| 列 | 说明 |
|---|---|
| `client_name` / `client_version` | 从 `client` 拆出 |
| `idempotency_key` | 唯一 |
| `body_sha256` | 正文哈希 |
| `payload_json` | 原始对象。过期后置 NULL |
| `adapt_status` | `pending_adapter` \| `adapted` \| `adapt_failed` |
| `adapt_error` | 失败原因，成功时为 NULL |
| `adapt_warning` | 敏感键被删等警告，可空 |
| `adapter_revision` | 产出当前规范行的适配器修订号，未适配时为 NULL |
| `received_at` | 首次入库时间 |

未知 `client`：行仍插入，`adapt_status=pending_adapter`。这不是拒绝。适配器注册之后，用第 4 节的重适配接口处理。

**`telemetry_host_binding`**

`sut_host` 主键，`system_id` 外键指向 `system.id`。由实施配置写入，不从载荷推断系统。主机无绑定或会话没有 `sutHost`：规范数据照存，该会话不沉淀。

**`telemetry_session`**

`batch_id`、`session_index`（批次内从 0）、`system_id` 可空、`sut_host`、`operator_ref`、`superseded`（重适配后旧会话为 true）。

**`telemetry_step`**

第 5 节的步骤列，外加 `session_id`。`feedback_json` 用 SQL NULL 表示未观测，用 JSON `[]` 表示已观测且无反馈。

**`telemetry_span`**

一次清洗后的页面段。

| 列 | 说明 |
|---|---|
| `session_id` | |
| `page_level_key` | |
| `status` | `ready` \| `incomplete` \| `too_long` \| `empty` \| `sedimented` |
| `signature` | `ready` 时为 sha256，否则 NULL |
| `happy_steps_json` | 进入签名的步骤快照，形如现有 `steps_json` |
| `exception_json` | 从快乐路径移出的系统拒绝 |
| `note_json` | `noEffect=disabled` 的步骤 |
| `superseded` | 重适配后为 true |

**`operation_component_telemetry_evidence`**

| 列 | 说明 |
|---|---|
| `component_id` | 外键，组件删除时级联 |
| `span_id` | 唯一。一段只支撑一个组件 |
| `stale` | 重适配后 true。不删行 |

**`operation_component` 新增**

| 列 | 说明 |
|---|---|
| `origin` | `trajectory`（默认，存量行）或 `telemetry`（本流水线创建） |
| `telemetry_evidence_count` | 非陈旧证据行数。轨迹挖掘的 `occurrence_count` 不动 |

语料创建的组件：`source_trajectory_id` 与 `source_phase_id` 保持 NULL，`grain=phase`，`status=draft`，`component_type=normal`。

## 7. 适配

适配器是纯函数：`(clientName, clientVersion, payload) → { sessions }` 或抛出「无法解析」。

- 代码里按 `clientName/clientVersion` 注册。没有注册项：批次留在 `pending_adapter`，规范表无行。
- 返回空 `sessions`：`adapt_status=adapted`，没有可沉淀的段。
- 抛出：整批回滚规范行，`adapt_status=adapt_failed`，`adapt_error` 为消息。原始载荷保留。
- 一个已注册版本的字段变化 = 新的 `clientVersion`，不改旧版本适配器的行为。

本文不附带任何真实插件版本的适配器。实现落地时用夹具适配器覆盖第 12 节的纯函数，不把同事草案里的字段名写进生产分支。

## 8. 清洗与切段

只处理一个会话里 `superseded=false` 的步骤。顺序固定，无模型调用。

按 `stepNumber` 排序后，分两段做。先切开，再在段内折叠。先折叠会把相邻两页上同名按钮合成一步。

**切开**

1. `eventClass=noise` 的步骤删除，不切断。
2. 对其余步骤按顺序线性扫描，命中即停：
   - `eventClass=unknown`：结束当前段。该步不进入任何段。
   - `action` 且 `pageLevelKey` 为空：结束当前段。该步不进入任何段。
   - `action` 且当前段已有别的 `pageLevelKey`：结束当前段。本步作为新段的第一步。
   - 其余 `action`：追加到当前段。当前段为空时，本步就是第一段。

**段内**

3. `feedbackObserved=true` 且 `feedback` 含 `error`、`warning`，或含不在 `error|warning|info` 内的 `level`：该步移出快乐路径，写入 `exception_json`。不切断。
4. `level=info` 的步骤留在快乐路径。它不是「无反馈」，因此不参与下一步的折叠。
5. 仍在快乐路径且 `noEffect=disabled`：移出，写入 `note_json`。不切断。
6. 快乐路径上相邻、元素身份相同、前一步 `feedbackObserved=true` 且 `feedback=[]`：删前一步，留后一步。元素身份取 `element.formLabel`、`element.placeholder`、`element.xpath_smart`、`params.label_text` 中第一个非空字符串（去首尾空白）。四个都空则不折叠。只折叠段内相邻步。
7. 点错字段再点另一个字段、走错页面，v1 不删。删错会把两段不同操作粘成一个组件；留着只会让签名更稀，达不到两个批次的门槛，组件不会被创建。

`feedbackObserved=false` 的 `action` 若留在段内，该段 `status=incomplete`，`signature` 为空，不沉淀。禁止把未观测当成「无系统反馈」去折叠。

折叠并切段之后标状态。快乐路径里只要还有 `feedbackObserved=false`，status 就是 `incomplete`，签名为空，不再按步数改判。其余按下表：

| 快乐路径步数 | status |
|---|---|
| 0 | `empty` |
| 1..30 | `ready`，计算签名 |
| >30 | `too_long`，无签名 |

签名输入是快乐路径步骤，`stepNumber` 按段内顺序重排为 1..n，然后调用 `computePhaseSignature`。快照调用 `stepsToSnapshot`。两函数的现有语义不改：自由填值不进签名，快照仍保留 `params`。

系统拒绝和禁用点击 v1 不单独成为组件。它们留在段的 `exception_json` / `note_json`，供审查稿展示，也供以后的规格使用。快乐路径被清空时，段是 `empty`。

## 9. 沉淀

每次适配成功结束时，对该批次新产生的 `ready` 段做一次沉淀。只看 `superseded=false` 且 `system_id` 非空的段。

分组键：`(system_id, signature)`。同一批次里两段签名相同只算一个批次。`(system_id, signature)` 的唯一约束包含废弃行，全库至多一行。

按这个顺序决定，三者只命中一条：

1. **已有组件**（`draft` / `confirmed` / `deprecated` 都算）：为尚未挂证据的 `ready` 段插入证据，`stale=false`。不调用命名，不改 `steps_json`、`name`、`description`、`signature`、`status`、`origin`。废弃组件不会被语料重新打开。`telemetry_evidence_count` 改为非陈旧证据数。这些段改为 `sedimented`。一个批次就够，不必再等第二个批次。
2. **没有组件，且不同 `batch_id` ≥ 2**：创建草稿。代表段取快乐路径最长的一段；步数相同取所属批次 `received_at` 较新者；仍相同取会话内较后的段。`steps_json` 用该段快照。命名复用 `scripts/prompts/component-mine-prompt.md` 与 `nameClusterWithLlm` 的回退规则（该函数目前是 `operation-component-mine-service.js` 的私有函数，实现时抽出共用，不另写提示词）。模型失败时名称用 `telemetry-` 加签名前 8 位。`origin=telemetry`。然后把组内全部 `ready` 段挂上证据并改为 `sedimented`。
3. **没有组件，且不同批次 < 2**：段保持 `ready`，不建组件。

`incomplete`、`too_long`、`empty`、未绑定系统的段不进入分组。

草稿的确认、废弃、删除沿用 `POST /api/v2/operation-components/:id/confirm|deprecate` 与 `DELETE`。本文不增加批量确认。`steps_json` 与 `signature` 仍不可 PATCH。

## 10. 重适配与保留

重适配读取仍在的 `payload_json`，用**当前代码里该 `client` 的适配器**再跑一遍。

- `payload_json` 已空：409，`adapt_error` 记 `payload_expired`，规范行不动。
- 成功：该批次旧会话、旧步骤、旧段 `superseded=true`。指向旧段的证据 `stale=true`。然后写入新规范行，并按第 9 节再沉淀。已存在组件的 `steps_json` 与 `status` 不改。人若认为旧草稿已无证据，自行 `deprecate` 或删除（仅 draft 可硬删）。
- 重适配不因幂等键而跳过。它是单独的接口。

原始 `payload_json` 自 `received_at` 起保留 180 天，到期置 NULL。`idempotency_key`、`body_sha256`、规范步骤、段、证据保留。180 天内格式仍可改，因为原始载荷还在，新适配器可以重放。

## 11. 审查

`node scripts/telemetry/review-drafts.mjs` 只写 `tmp/telemetry-component-review.md`，不调用 confirm，不改库。

每行一个 `origin=telemetry` 或 `telemetry_evidence_count>0` 的组件：id、名称、签名前 8 位、快乐路径动作与标签、非陈旧证据涉及的批次数、不同 `operator_ref` 数（全空则写「未知」）、最多 3 条 `exception_json` 文本。

确认人用现有 confirm 接口。审查稿不是金标，不得写入 `scripts/characterization/fixtures/kb-recall-eval.v*.json`。

## 12. 测试

新 pin：`scripts/characterization/cold/characterize-telemetry-component-draft.mjs`，调用纯函数，不连库。登记进 `verify-all.sh`。至少覆盖：

- 相邻同标签、已观测且无反馈：只留后一步
- `feedbackObserved=false`：不折叠，段为 `incomplete`，签名为空
- `error` / `warning` 反馈：步离开快乐路径，进入 `exception_json`，段可以仍是 `ready`
- `unknown` 与空 `pageLevelKey`：切断，该步不进段
- 换页切断
- 快乐路径 31 步：`too_long`，无签名
- 快乐路径的签名与直接调用 `computePhaseSignature` 相同
- 敏感键从 `params` 与嵌套 `element` 中删除
- 已有组件时，1 个批次即挂证据、不改 `steps_json`
- 没有组件时，不同批次不足 2 不创建；达到 2 才创建

不修改召回评测夹具，不把语料样本放进评测集。

## 13. 实现落点

| 事项 | 位置 |
|---|---|
| 路由 | `src/routes/v2/telemetry.js`，在 `src/routes/v2/__init__.js` 注册 |
| 适配、清洗、沉淀 | `src/services/telemetry/` |
| 迁移 | 新文件，只加第 6 节的表和列 |
| 审查稿 | `scripts/telemetry/review-drafts.mjs` |
| 契约说明 | `src/dashboard/api-docs/catalog.js` 增加本路由。文档只写第 4 节的信封，不列举 `payload` 字段 |
| 门禁 | 第 12 节的 pin |

## 附录 · 同事草案字段对照（非契约）

下列左列来自同事 2026-09-22 设计稿，右列是适配器将来可以填的规范字段。左列改名或删除时，本文不改。

| 草案中可能出现的信息 | 规范字段 |
|---|---|
| 插件名与版本 | 信封 `client`，不进 `payload` 也行 |
| 会话起止、操作员引用 | 会话 `operatorRef`；起止可不映射 |
| 被测主机 | 会话 `sutHost` |
| 原始 `mousedown` / `input` 等 | 适配器决定 `eventClass` 与 `actionType`。控制面没有这张映射表 |
| `xpath_smart`、label、placeholder | 步骤 `element` |
| toast、校验红字 | `feedbackObserved=true` 与 `feedback` |
| 这一版没采反馈 | `feedbackObserved=false` |
| 退格、清空重填 | v1 不读。需要时作为新的规范字段另开规格 |
| 通过 / 未通过 / 作废 | v1 不读。作废应在插件侧不投递；投递了也只当普通批次 |
| 业务单号、网络 path | v1 不读，不写流程卡 |
