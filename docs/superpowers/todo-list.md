# 总 TODO（2026-08-13 基线 · 2026-08-31 重整）

> **跨会话共享清单。** Cursor 会话内 TodoWrite 不跨聊天；以本文件为准。  
> 本文件只跟踪**未闭环**项；已交付/已闭环条目不再保留，历史以 git log 与 `CHANGELOG.md`（仅历史存档，2026-08-31 起不再强制更新）为准。  
> 缺陷已全部修复关闭（2026-08-20 确认，含 1448052）。  
> 控件视野主线细节仍以 [`backlog-visible-editable-controls.md`](backlog-visible-editable-controls.md) 为准。

## 当前工作线（2026-08-31 起）

### ⑦ 客户管理 KB

- **档位 A（对公建档）已闭环**：#515+#524；fid=7；stamp 列表可见；P2 可回放。
- **档位 B（客户信息查询）进行中**：独立卡 `customer_query` 挂 **9000000039**；浅成功=复用 stamp `KB测客户-20260905-1315` 列表命中；设计 `specs/2026-09-05-customer-query-kb-design.md`。
- 遗留（档外）：引擎 phase_done 门闩；法定代表人引入深录；个人客户/OCR。

### ⑥ 产品管理 KB（挂载收尾完成）

- 五叶子齐：0740 / 0467 / 0468 / **0811 阶段** / **0812 映射**；0230/0231 为 intermediate 目录。
- KB 卡已回写 0811/0812；要素 pageId 空属预期；`product_library` 未动（他线）。
- 菜单线：正式 `systemId=1` 全量 scan 已完成；对公客户管理孪生已合入 json_import（`7`←`1478`）；产品五叶 OK；**待办仅剩下周一推送**。

### ① 830 任务收尾：自测 + bug 修复

任务①（截图+坐标）、②（元素分级分区）、③（V3 推送）已全部交付并湿测通过；任务④（报文捞取）已重启，见 ②。剩余：

- 真机自测 + 消费方反馈驱动的 bug 修复。
- **同名弹窗 title 回退歧义**：popupKey（含 anchor）对齐正常；仅控件缺 `popup_level_key` 回退 title 查找时可能挂错实例——**待湿测证据**再定改法。
- **rect 非法值照推**：rect 已改 JSON 字符串并新增 `rect_norm` 归一化（0~1）；`noRectControls` 仅统计可见，是否升级为构建失败待消费方反馈。

### ② 报文捞取 MVP：Tasks 7-10（抓取 + 持久化）

- 已完成：click_button 统一改名（Tasks 1-6，`dfb5c9e`）、elk-msg-extract CLI（`8148f72`）、契约对齐+回填验证（`1fcd1b9`/`b837d67`）、SUT 三接口请求文档产出、字段映射 122/122 评估（100% 支持）。
- 待执行：录制链路报文抓取接入 + 报文/映射持久化（Tasks 7-10）；非消费型过滤与四边界场景 JS-gen 侧兜底。
- 设计：[报文日志捞取接口设计.md](../报文日志捞取接口设计.md)；原则：JS-gen 侧逻辑优先于 SUT 增强，接口契约维持最小集。

### ③ 菜单切换：推送链路（已收官 · 2026-09-04）

- 已落地：JSON 导入 / 菜单扫描 / 删除拦截 / 执行期导航 / pageId 绑定 / 5.3–5.4 迁移 / removed_flag / 伙伴 `getSystemNodeLevel`+`importData` 真推送 / D1–D5 本仓实现。
- **Q1 推送数据**：同事已确认报文无误——**已完成**。
- **Q2 完成回调**：产品拍板不需平台回调；`importData` 200 即完成——**已完成**。
- **T5 九条规则回归**：`node scripts/characterization/characterize-menu-import-nine-rules.mjs` **18/18 OK**（快照/5.3 迁移/5.4 交易跟随/5.5 改名/新增/5.7 收编/5.8 删保留/5.9 下线 + 推送 menuVersion/归属）。菜单切换本仓联调可交付。
- 可选：P3 名称映射表「扫描自动沉淀」（约 0.5 天）。

### ④ 服务器/运维（O7 · 安全最高优先）

- 阿里云安全组关 3306/6380 对公网（8-31 已备 SSH 隧道脚本 `config/open-db-tunnel.cmd`，启用须改 .env DB_HOST/DB_PORT）；iptables 持久化；删除 recover_your_data 勒索库；排查 crontab/authorized_keys；mysqldump 定时备份 + 异机存储；数据泄露评估。
- 已完成底座（8-28/8-31）：DB 迁移 47.101.58.49 全量覆盖零差异、docker mysql restart=always、root@% 补 GRANT ALL、DB_POOL_MAX=20 + compress 热修。

### ⑤ KB-I5 引擎自主闭环（P1/P2 已达成 · 2026-09-05，转下阶段）

- **已达成**：P1 引擎自主闭环（YXPC20260905012040 纯引擎提交进审批，run26→26j，commit `0f80d3c`）+ P2 批量自批（累计 8 笔批复）。引擎侧 VERIFY 收紧 + xhr requestBody 捕获已落地并真机验证。
- **下阶段**（见 [`research/2026-09-05-engine-closure-phase2-plan.md`](research/2026-09-05-engine-closure-phase2-plan.md)）：P3 链 B 打通（135292 评级二次调查→授信解锁）→ P4 KB 扩卡 24→28（run26 配方沉淀）→ P5 引擎环境缺口（已登录跳过/验证码/锁定轮询）→ 单会话全自主复跑终验。
- 盛达草稿清理定案：SUT deleteBefore 对待发起半成品静默拒绝，前端不可删，8 笔保留（12031/033-039）。
- A7 探索项（已写锚点与卡）：**影像上传录制回放可行性**（wf_ctrcontsign_com，用户暂缓）——验证通过后 ctrSt 3→6 放款闭环。
- **P3-C 链B合同签订推进（2026-09-05）**：主合同 9881020044006（批复 DGYXPF202609050016010 自动创建，推翻 A6 手动创建）签订信息已填齐保存（含合同账户放款+还款主双账户），提交拦于担保合同 988104260032001 期限缺失。**产品裁定（09-05）：所有涉及文件上传的场景一律搁置**——纸质签上传影像路线封死，合同止于已保存态；链B 在合同环节暂停，待产品排期上传能力后续跑（担保合同期限维护入口探明→提交→签订中→上传影像→生效→放款 loan 卡配方）。KB duigong_contract_sign 卡 +4 规则。

## 挂起 / 按需（湿测 + 工程债 + 产品残留）

| ID | 优先级 | 项 |
|----|--------|-----|
| **heal-locate-wet** | 待跑 | Heal-Locate live 冒烟：真实浏览器 + 后端 + executor；Phase 7 级联隐藏/折叠/Tab/Dialog/缺字段场景；`HEAL_LOCATE_DECISION_ENABLED=1` 路由验收 |
| **L1-picker-wet** | 挂起 | 多「新增」Vue 选择器冒烟；等执行机 / BiB 重载 |
| **page-state-wet** | 挂起 | dialog/drawer 内/外同文案按钮碰撞湿测 |
| **L1c-wet** | P1 挂起 | `L1C_LLM=1` BiB 湿测低置信区域 |
| **L1c-scan-py** | P1 挂起 | Python scan 接入 `classify` / regions classify（与 L1c-wet 可同刀） |
| **AG-fullpage-wet** | 按需 | 无 label inventory BiB/UI 冒烟 |
| **session-lifecycle-wet** | 挂起 | A attach → streamDetach → B 同 Chrome 409 `grace_owned`；需在线执行机 + 已加载新控制面 |
| **T1r** | 穿插 | tree / replay label 兜底残余 |
| **T3r** | P2 | 活录 CDP 对拍残余 |
| **T4-P4** | P2 | Playwright MCP a11y ⟷ L2 对拍（灰度，非写路径） |
| **L1-vision** | P2+ | 争议容器裁图辅助定角色 |
| **T5** | 暂缓 | 非 `el-table` 自定义网格；需另页证据 · [gap](specs/2026-08-10-t5-credit-scan-gap-design.md) |
| **T9** | 部分 | 产品 `steps/replay` 常态验收（运维） |
| **PR-SSO-ADMIN** | 挂起 | 管理员映射/权限闸等会议结论；阻塞 messages/case-data/screenshots 用户隔离、单条归属校验、「只看我的」UI |
| **PR-EXEC** | 挂起 | 脚本执行（引擎/执行机）；本侧只提供浏览器操作与 actions 设计，暂不排调度产品 |
| **PR-BATCH 小缺口** | P3 | 列表页 batchTaskName 筛选入口、顶栏徽标文案（后端参数已支持） |
| **PR-LOC-HL** | 前端主力 | 步骤级高亮（bbox 画框）本体由前端开发；后端待前端推送结构要求后改数据结构（G 阶段内状态组截图已落 `0e1bee0`） |
| **login-retry-heuristic** | P3 | prepare 登录冷启动失败固定等 8s 重试一次（attach-runner.js:197）是启发式非事件驱动，慢环境会误判失败；改事件驱动/指数退避（来源：2026-09-05 会话生命周期梳理 §5.8） |
| **stop-busy-race** | P3 | record/stop 不等 busy（可能 stale）直接发 cancel_step（record-lifecycle.js:321 注释自认）；极端时对正收尾的 agent 发取消（来源同上） |

## 更新记录

> 逐日工作流水已移交 [agent-log.md](agent-log.md)（跨工具共享日志；「开场三件事 / 收工写日志」约定见 AGENTS.md）。本文件只维护工作线与挂起项。
>
> - 2026-09-04 菜单切换：Q1 推送数据已确认；Q2 产品拍板不需平台回调，200 成功即完成；联调剩 T5 九条规则测试
> - 2026-08-31 大重整：清出已闭环区段（当前聚焦 830 / 挂起待优化表 / 产品排期区 / 8-17~8-19 排期框架 / 工程债收尾项），新增「当前工作线」四条 + 挂起/按需合并表；CHANGELOG 强制约定废止并从 AGENTS.md 移除
> - 2026-08-13 ~ 08-24 历史逐日记录：`git log -p -- docs/superpowers/todo-list.md`
