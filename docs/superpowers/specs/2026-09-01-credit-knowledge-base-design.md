# 信贷业务流程知识库框架设计（KB v1）

- 日期：2026-09-01
- 依据：K1 computer-use 业务流实地调研（tmp/k1_notes.md，六条业务流）+ K2 平台知识形态调研（tmp/k2_notes.md，四层知识形态与缺口）
- 目标：让 Python 侧 Agent 在被测系统（天阳信贷）上执行复杂业务流程时，**按需召回流程知识**（节点图/前置条件/字段依赖/状态语义），替代"每次现场摸索"

## 一、设计原则（来自调研的直接推论）

1. **不重建已有层**：值语义（1333 个字典类型）、导航（menuXpath+天元编码）、序列（轨迹+定位器链）、字段映射（task_list label→选项）都有现成来源——知识库只做**采集归一 + 召回接口**，不做人工录入。
2. **增值在第五层**：调研证明平台不提供的「流程依赖知识」（环节 DAG、按钮→后果、状态前置闸门、隐性编码规则）才是 Agent 最缺的——这类知识通过 K1 式 computer-use 调研**半自动沉淀**，以 fcnScnEcd/业务主键前缀为主键。
3. **召回即动作**：知识不放 prompt 里堆 token，做成 Agent 可调用的 `kb_*` 控制器动作，按阶段按需查询（对齐廉价观察阶梯）。
4. **条目粒度**（K1 建议）：流程级（节点图+前置闸门）/ 页面级（列表页模板+差异）/ 字段级（仅依赖组与跨页回填链）/ 状态级（状态×动作矩阵）/ 隐性规则类（编码表、命名规则）。

## 二、知识库分层（五层）

| 层 | 内容 | 来源 | 存储 | 召回接口 |
|---|---|---|---|---|
| L1 值语义 | 字典项 编码↔名称（归一后） | localStorage `vue_Tansun_dict`（1333 类型）浏览器导出 | `kb_dict` 表（dict_type 归一键 + text/value/seq） | `kb_dict(dict_type, text?)`：查码表/反查 |
| L2 导航 | 系统→模块→功能 + menuXpath + 天元编码 | JS-gen 系统树（已有） | 复用 system/process/function 表 | 既有 click_menu_item 链路 + `kb_nav(功能名)` |
| L3 序列 | 已录轨迹步骤链（含定位器/输出） | trajectories + elementJson | 复用 trajectory 表（phase 回填补齐） | `kb_seq(function_id, 任务相似度)` |
| L4 字段映射 | label → 选项/必填/实值 + dictType 挂接 | business-data task_list + L1 选项匹配 | `kb_field` 表（label, page_ctx, dict_type, required…） | `kb_field(label)`：返回选项码表与依赖 |
| L5 流程依赖 | 流程卡：节点图/前置闸门/状态×动作矩阵/字段依赖组/隐性规则 | K1 式 computer-use 调研 + 多轨迹对比，**半自动沉淀** | `kb_flow` + `kb_flow_node` + `kb_state_action` + `kb_rule` 表（JSON 卡片） | `kb_flow(流程名)`：节点图+闸门；`kb_state(实体,状态)`：允许动作；`kb_rule(关键词)` |

## 三、知识条目 Schema（L5 为核心，v1 首批 6 张流程卡）

```yaml
flow:                              # 流程卡（kb_flow）
  name: 对公授信申请
  biz_key_prefix: [PMS]            # 业务主键前缀编码
  preconditions:                   # 前置闸门（nextBefore 实证）
    - 客户状态须为信贷正式客户（信贷预客户被 nextBefore 静默拦截）
    - 替代路径：二合一（授信+用信合并发起）
  nodes:                           # 节点图
    - {id: list, page: 授信列表页, enter: 菜单链, buttons: [新增/修改/查看/撤销/流程轨迹]}
    - {id: form, page: 授信申请表单(抽屉), enter: 点击新增, buttons: [选择客户/保存/提交]}
    - {id: picker, page: 选择对公授信客户弹窗, enter: 选择客户, note: 三段式查询→单选→确认}
  field_deps:                      # 字段依赖组（标志→明细）
    - {if: 上市公司标志, then: [上市地, 股票代码]}
  state_actions:                   # 状态×动作（引用 kb_state_action）
    - {status: 审批中, allow: [撤销, 流程轨迹]}
  exceptions:                      # 实测异常/缺陷
    - vCratNo is not defined（测试环境前端缺陷，2026-08-31 实证）
```

首批沉淀（K1 已采集）：对公客户建档 / 对公授信申请 / 对公用信申请（引入语义）/ 审批待办（含业务主键前缀表、退回_命名规则）/ 客户 360 视图 / 登录+会话（倒计时、验证码环境开关）。

## 四、采集管线（沉淀怎么来）

| 管线 | 内容 | 方式 |
|---|---|---|
| P1 字典导出 | 一次性 dump `vue_Tansun_dict` → 归一 → kb_dict | js_snippets 新增 `JS_EXPORT_DICTS`（读 localStorage），Agent 登录态下执行一次；同义 dictType 归一映射表人工确认一次 |
| P2 流程卡沉淀 | K1 纪要 → 结构化 YAML → 入库 | 人工+LLM 半自动（已有 6 条流的调研素材）；后续新流 = computer-use 调研（K1 模板）→ 同 schema 入库 |
| P3 轨迹回填 | phase 标注补齐 + 按钮→后果标注 | 录制时 phase 已有（P0-P5 实证）；存量轨迹按 functionId 批量标注 |
| P4 字段挂接 | task_list label 选项 ↔ kb_dict 匹配 | 选项文本集与字典 text 集合相似匹配，人工确认低置信项 |

## 五、召回接口（Agent 侧新增控制器动作，js_snippets 不涉、纯 Python+DB）

- `kb_flow(flow_name)` → 节点图 + 前置闸门 + 状态×动作（录制 P0 预检/走新流程前调用）
- `kb_dict(dict_type, text?)` → 码表或反查（填 select 前确认值的编码语义）
- `kb_field(label)` → 字段依赖组与 dictType（遇到「标志→明细」联动时调用）
- `kb_state(entity, status)` → 允许动作矩阵（决定下一步可点什么，防无效操作）
- prompt 侧：业务速查表改为「先 kb_flow 召回，知识缺失再现场摸索；摸索结果回填知识库」的闭环 cue

## 六、实施批次（建议）

| 批次 | 内容 | 验收 |
|---|---|---|
| KB-1 | P1 字典导出 + kb_dict 表/DAO/`kb_dict` 动作 + 归一映射 | 登录态导出 1333 类型入库；`kb_dict('cstSt')` 返回 6 项 |
| KB-2 | L5 表结构 + 首批 6 张流程卡（源自 K1） + `kb_flow`/`kb_state`/`kb_rule` 动作 | `kb_flow('对公授信申请')` 返回含 nextBefore 闸门 |
| KB-3 | P4 字段挂接 + `kb_field` 动作 + prompt 闭环 cue | 抽屉 scan 后 label→dictType 命中率抽样 ≥80% |
| KB-4 | 湿测对照：Agent 走「用信申请」（未调研过的新流程）有/无 kb 召回对照 | 有召回时无效操作步数显著下降；缺口回填知识库 |

## 七、边界与风险

- 字典 1MB 全量入库需归一去重（同义 dictType 泛滥，如 cstTp/cstTpcd/CstTpCd）——归一映射表是 KB-1 的人工确认点
- L5 流程卡质量依赖 K1 式调研纪律（禁触不可逆动作）；「授信表单分区」因 nextBefore 闸门未采到，需用信贷正式客户补采或走二合一路径
- 登录 HTTP 化（createToken payload）未破解——字典导出走浏览器 localStorage 路线绕开，不阻塞
- 轨迹 phase 全空的存量缺口由 P3 管线补，历史异常分支轨迹少是长期积累项
