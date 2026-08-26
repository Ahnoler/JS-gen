# 报文捞取+日志解析 ELK 验证（对公客户管理） Spec

> 日期：2026-08-26
> 状态：**待评审**
> 关联：`2026-08-25-sut-three-interfaces.md`（三接口契约）、`2026-08-25-message-capture-mvp-spec.md`（JS-gen MVP）、`2026-08-25-field-mapping-method.md`（映射方法）、`saveCustCorporat-field-mapping.json`（接口一/二等价数据）

---

## 1. 需求澄清结论（用户确认）

1. **三个接口（元素定义/接口结构/日志文件）由信贷系统开发人员提供**——契约已定（见三接口文档），SUT 侧未实现，JS-gen 是消费方。
2. **本次用 ELK 日志做简单验证**，模块=**对公客户管理**。
3. **目的**：验证「报文捞取 + 日志解析」**可用于表单字段的回填**。

## 2. 现状对照（已核实）

| 项 | 现状 |
|---|---|
| ELK 数据 | `/_search`（无索引，与 Kibana discover 等价）；appName=`tansun-tcp-cst`；msg 含完整 `===== API Request =====` 报文块（Method/URI/Content-Type/Request Body/Response Body/Status）；关联键 globalTraceNo/localTraceNo/parentTraceNo；`traceId` 字段损坏不可用 |
| 捞取/解析工具 | `scripts/log-extract/elk-msg-extract.mjs` 已实现并实测（30min=22 条、48h=1061 条、0 解析失败），已提交 `8148f72` |
| 契约对齐（Phase A） | 已由 GLM-5 实现（complete 标记/跳过不完整默认开/`--latest N`/网关前缀段级后缀匹配/characterize 注册）——**未经主 Agent 审查，未提交** |
| 接口一等价数据 | `docs/superpowers/specs/saveCustCorporat-field-mapping.json`：api(method/url)、page、fields[]（section/label/prop/value/type/disabled/display）——对公客户保存表单的字段映射样本 |
| SUT 三接口 | 未实现（devtool 404 / test 回 SPA HTML） |
| system_ref 框架 | 表+DAO(`save`/CRUD)+路由已搭好；无 POST 端点、无去重列；持久化链路未实现 |

## 3. 目标 / 非目标

### 目标（本次验证）

1. 用 ELK 捞取对公客户管理模块的**真实报文**（含写操作如 saveCustCorporat 或同表单 POST 报文字段）
2. 解析为结构化记录（含 complete 过滤、字段值提取）
3. 以 `saveCustCorporat-field-mapping.json` 作为**接口一/二等价物**，验证「报文字段 ↔ 表单字段」映射：
   - requestBody 顶层字段名 ↔ mapping.fields[].prop 的结构匹配
   - 生成可回填 KV：{prop, label(中文名), section, type, value(报文值), masked(脱敏标注)}
   - 输出匹配率 + 差异清单（未匹配字段、映射有而报文无的字段）
4. 端到端实跑 + 回填可用性报告

### 非目标（后续迭代）

- 接入 SUT 三接口真实数据（SUT 开发人员实现后；映射源替换为接口一返回值，**方法不变**）
- system_ref_data 持久化（正式链路再做；本次验证不写库）
- 录制实时被动监听 / 录制自动注入回填值
- 前端展示 / V3 导出改造 / 消费型字段过滤（验证码、token——本次仅标注）

## 4. 数据流

```
ELK(_search, appName=tansun-tcp-cst, 时间窗)
  → elk-msg-extract.mjs（捞取+解析+complete 过滤+可 --latest N + --uri 网关后缀匹配）
  → records.json [{method,uri,status,requestBody,responseBody,logdate,trace…}]
  → validate-backfill.mjs（输入: records + saveCustCorporat-field-mapping.json）
      ├─ 网关 url ↔ 日志 URI 段级后缀匹配（接口一 url=/prod-api/…/custCorporat/saveCustCorporat ↔ /custCorporat/saveCustCorporat）
      ├─ requestBody 顶层 key ↔ mapping prop 匹配 / 反查
      ├─ 脱敏值检测（值含 **** → masked=true，标注待人工校正）
      └─ 回填报告 report.json/md（接口清单、匹配率、KV 样例、差异、未匹配解释）
```

## 5. 回填验证方法（validate-backfill.mjs 设计）

纯函数（便于 characterization pin）：

- `extractBodyFields(body)`：容错字段提取——body 为对象取顶层键；为数组（如批量保存）取各元素对象键并集；为字符串时先 `JSON.parse`，失败（真实数据：脱敏值未转义引号导致）则用键名正则提取键名、值 best-effort 捕获并标 reliable:false/bodyParseable:false；返回 {fields, bodyParseable}
- `matchApiRecord(record, mapping)`：按网关后缀匹配映射 api（mapping.api.url 已知，复用 `matchUriWithGatewayPattern`）；返回 {matched, methodMatch}
- `buildBackfillKv(record, mapping)`：
  - requestBody 为对象时取顶层 key；每 key：
    - 在 mapping.fields 中按 prop 命中 → {prop, label, section, type, value, masked}
    - 未命中 → 进 unmatchedRequestKeys[]（判定：系统字段如 id/createUser/createTime/version/tenantId/delInd 等 → 归类 hidden/system；其余 → unknown）
  - 反查：mapping.fields 中 prop 不在 requestBody → mappingNotInRequest[]（可选项/系统生成）
- `summarizeBackfill(results)`：接口数、记录数、平均/总体匹配率、KV 总数、未匹配统计、脱敏统计
- 输出：`report.json`（机器可读）+ `report.md`（人读摘要，含 Top 样例表）

## 6. 验收标准

1. 实跑：最近 48h 对公客户管理报文全部解析（解析失败 0 / 不完整块按契约跳过并计数）
2. **表单写接口报文已存在**：放宽 48h→3 天窗口，已捞到 `/custCorporat/saveCustCorporat` **3 条**（2026-08-24 14:29/17:36、2026-08-25 12:11，status 200）及 checkCustCorporat 等查询报文；以其 requestBody 字段对 mapping.fields 的**匹配率 ≥ 90%**（未匹配项需按系统字段/嵌套/unknown 归类并可解释）。注：saveCustCorporat 请求体为扁平大对象（~100+ 字段），**因脱敏值未转义引号整体 JSON 不可解析**——按 §5 `extractBodyFields` 容错路径提取键名与 best-effort 值
3. 回填 KV 样例：≥10 条含中文名/分区/类型的可读样例；脱敏值均被标注
4. `characterize-log-extract.mjs` + 新增 `characterize-backfill.mjs` 全过；`verify-all.sh` ALL GREEN；lint 0 error 0 warning
5. 报告交付：`logs/backfill-report-*.json/md`（产物不入库）

## 7. 风险与对策

| 风险 | 对策 |
|---|---|
| 时间窗内无 saveCustCorporat 报文 | 前置条件写入计划：先在测试环境登录对公客户管理做一次新增/保存（可请用户/被测方）；退路=checkCustCorporat 子集验证 |
| mapping.json 为样本（值非全真实、字段可能不全） | 报告标注为「样本映射源」；SUT 接口一上线后替换为真实数据 |
| 脱敏值回填需人工校正 | 所有含 `*` 的 value 标 masked=true，报告明示 |
| 报文含嵌套对象/数组 | 仅顶层 key 参与本次验证（嵌套字段映射后续迭代）；在报告 unmatched 中列出嵌套 key 名 |
| GLM-5 产出未审查 | 本 spec 评审通过后，对照本 spec 逐项审查 Phase A 代码，偏差返工后才进入执行 |

## 8. 涉及文件

| 文件 | 动作 |
|---|---|
| `scripts/log-extract/elk-msg-extract.mjs` | 已实现（待审查；如需小修在此） |
| `scripts/log-extract/validate-backfill.mjs` | **新增** |
| `scripts/characterization/characterize-log-extract.mjs` | 已实现（待审查） |
| `scripts/characterization/characterize-backfill.mjs` | **新增** |
| `scripts/refactor/verify-all.sh` | 追加 1 行（characterize-backfill） |
| `scripts/log-extract/README.md` | 补充验证用法 |
| 本 spec + plan | 评审后提交 |

> 全部为 scripts/ 变更 → 依 AGENTS.md 可不写 CHANGELOG（若最终触及 src/ 则必须补）。
