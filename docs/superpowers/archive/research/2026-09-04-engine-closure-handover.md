# 引擎自主闭环冲刺·收尾与交接（2026-09-04）

> 本文是「引擎 100% 自主闭环」冲刺的**收尾快照**：当前位置、已定案结论、遗留问题、下批推进路线。
> 接手者从「下批路线」一节直接开工；所有配方/动作/知识均已就绪，无需重新探索。

> **⚡ 阶段收尾（2026-09-05 03:30，Zcode 接手会话）**：P1/P2 已完成——P1 引擎自主闭环达成（YXPC20260905012040 纯引擎提交进审批，run26→26j，引擎侧 VERIFY 收紧+xhr requestBody 已入 `0f80d3c`）；P2 第二波批复 DGYXPF202609050016008/009 已生效（累计 8 笔）。盛达草稿清理经用户授权后定案：**SUT deleteBefore 钩子对「待发起」半成品静默拒绝（无 toast/无弹窗/reload 无效/编辑页无整单删除入口），前端不可清理，8 笔草稿保留**（12031/033-039）。后续路线更新见 `2026-09-05-engine-closure-phase2-plan.md`。本文其余内容保留作为配方/定案档案。

## 1. 当前位置（截至本文）

- **用信提交进审批：6 笔**（009/012/019/020/029/032，全部盛达建筑，3 万/笔）
- **批量自批通过：4 笔**（012/019/020/029，WN0001 批，批复 DGYXPF202609040016004-007 自动生成生效）
- **冻结链**：4 笔审批通过（引擎纯自跑闭环已达成，见 `docs/superpowers/research/2026-09-01-e2e-chain-a.md` + run15-24 记录）
- **引擎自主闭环（用信链）**：**~90%**——S1-S7（建档/品种树/八分区/担保落库）纯引擎全绿；卡点收敛为「引入保证人确认的稳定性」+「七模块填写的完整性」，详见 §3

## 2. 已定案结论（全部实锤，勿再重新探索）

### 2.1 页面形态与流程结构
| 事实 | 来源 |
|---|---|
| 用信新增 = el-drawer「新增用信申请」两步向导（客户引入/业务发生类型/发起模式→风险阻断→申报页） | usage_probe.md |
| 引入客户 = 「客户放大镜」弹窗，picker query+select 两拍 | A3/r10b |
| 「维护方案品种明细」弹窗**没有分项行列表**——产品树（tree-popover）选中即回显 4 只读字段 | pz_probe.md |
| 产品树 = **逐级点文本**（触发器=span.el-tooltip.my-popover.item，input 隐藏；精确匹配防"贷款"子串陷阱） | pz_probe/run4 |
| 品种明细确认按钮=「确认」（无空格）；弹窗无金额框 | run4 |
| 主担保码值：抵押1/质押2/**保证3**/信用4（r8a"保证=2"系误记） | run10b/r20 |
| 「下一步」闸校验 doDclScmNextCheck code:100 **前端呈现不稳定**：有时 3s 异常通知（el-notification.exception-message）、有时完全静默 | 用户截图 2026-09-04 |
| 异常通知 className="el-notification exception-message right" **不含 error 字样**（el-icon-error 在子元素上）——过滤逻辑不能依赖 includes('error') | 用户截图 |
| 意见页「流程操作」下拉**看似已选实为空**——必须显式 select_option | r14/r20 |
| 用信流程选人候选池**不含 701994**（张某某/黄亮/黄磊明/李克），选黄亮 WN0001 | A6/r14 |
| 冻结/用信=定人审批（节点处理人固定）；701994 待办 104 条角色派单≠定人 | A6 |

### 2.2 SUT 缺陷/怪癖清单（非我方问题，均已绕行或记录）
1. tsscMutilDialog 关闭后 wrapper 空壳**跨路由存活**，拦截真实点击并使按钮 disableBtn——绕行=浏览器 reload
2. 保存/确认成功但**数据未持久化**（间歇性，分区保存按钮歧义加剧）——对策=save_section+read_xhr_log 请求体核对
3. NextCheck 拒绝**呈现不稳定**（3s 通知或完全静默）——对策=read_xhr_log 读 bodyTail
4. radio UI 勾选与 Vue model 脱节（保存发旧值）——对策=set_vue_model+请求体核对
5. checkWrntTxNumb「获取法人行最高抵质押率失败」致押品无法保存（后端）
6. 评级「系统评级结论」保存报 `i18n is not defined`（前端缺陷）
7. 数字产业分类 DIGT_IDY_CL 列仅容 2 字符（'00'）
8. BP 浮动点被前端自动计算 (10-3.75)×100=625 覆盖手输
9. 行业树须点**最深叶**（K7010），中间节点不回填

### 2.3 引擎动作谱系（全部已入库+pin）
`tree_picker_click`(逐级点文本+CDP 回退) / `tree_check_confirm`(勾选树+成功谓词) / `select_tree_option`($emit 三段式) / `introduce_guarantor`(引入保证人复合+幂等) / `read_error_notify`(异常信息弹窗+notification 四通道+__notify_log) / `read_xhr_log`(静默闸自诊) / `save_section`(分区作用域保存) / `real_click`(CDP trusted) / `set_vue_model`(model 直写) / `close_visible_dialog` / `strip_stale_dialogs` / `fill_table_cell`+`select_table_cell`(表头定列序+四级行匹配)

### 2.4 账号与数据
- 账号：701994(黄某某)/WN0001(黄亮)/**135292(张某某)** 全密码 1；用信选人候选池无 701994
- 已占用保证人（在途申请引用）：26090119045027429(009)/26081317115618826(012)/26081714051504629(019)/26081521133548828(020)/26081317084540424(032)
- 盛达草稿堆积：015-018/021-028/030-031/033+ 等约 15 笔待发起半成品（各轮湿测产物）——**清理决策待用户**
- 审批中在途：032 + 批量通过后已出批复 4 笔（012/019/020/029）

## 3. 遗留问题（挂起，含精确修法）

### 3.1 引入保证人确认的稳定性（任务 1 残留）
- **现象**：同配方在 012/019/020/029 成功、在 031/032/038 引擎路径间歇性"确认后列表空"；用户手动确认在 032 出现「重复引入」异常弹窗（证明引擎此前其实已引入成功——`introduce_guarantor` 的 VERIFY 段误读了弹窗候选表，假阳性 rows=1）
- **修法（已定案未落码）**：
  1. VERIFY 收紧：命中行必须**同时校验"与借款人关系"单元格值==所填 relation**（防读到同名其他表）
  2. 成功判定统一以 **NextCheck 过闸**为金标准，动作返回仅作参考
  3. `read_error_notify` 的 already-introduced 语义 → 查主列表行在即返回幂等成功（已部分实现）
- **工作量**：VERIFY 段 ~15 行 + pin 断言；半小时级

### 3.2 七模块填写的完整性驱动
- run25b 实测：S7a/c/d/e/f/g/h 逐分区保存 200，但 NextCheck 仍报「申请金额信息/还款/利率/产品/贷款投向/政府关联/贷款详细 未保存」——部分分区的"保存"未触达正确按钮或字段填写未进 model
- **修法**：以 r20（029 全成功）的 MCP 操作序列为基准逐分区比对 run25b 的引擎动作 diff——纯调试，无新代码

### 3.3 环境缺口（引擎侧登记）
- prepare 的 login replay 打在**已登录会话**上必失败（缺「已登录跳过」分支）
- 新登录页可能出现图形/手机验证码（引擎无验证码识别；人工识读通过即可）
- 701994 重试过猛会「用户已锁定」——需解锁窗口轮询（run24 已实证 CDP 自动登录可行）

## 4. 下批推进路线（按优先级）

| # | 任务 | 依赖 | 预估 |
|---|---|---|---|
| P1 | **引擎自主闭环终验（run25 续）**：3.1 VERIFY 收紧 + 3.2 以 r20 配方修正七模块驱动 → 单轮串跑到审批中 | 无 | 1-2h |
| P2 | **用信批量自批第二波**：032+后续新单（batch_appr 配方照抄，WN0001 登录循环） | 无 | 1h |
| P3 | **链 B 打通**：135292 登录 → 批评级二次调查 PJ20260901016003 → 评级生效 → 授信 DGSX20260901056031 解锁 → 继续链 B | 无（账号已通） | 1h |
| P4 | A7 影像上传探索（录制回放可行性）——用户暂缓 | - | ? |
| P5 | KB 继续扩卡至 ~28 张（沉淀本批 approval/guarantee 细节已部分入卡） | P1 | 0.5d |
| P6 | 押品模块：等 SUT 修复抵质押率接口；催收：无在途任务受限 | SUT | - |

## 5. 快速上手命令

```bash
# 会话（若服务未起）
netstat -ano | grep ":4097"          # 控制面
config/open-db-tunnel.cmd            # DB 隧道（若 13306 不通）
cd /d/dev/JS-gen && npm start        # 控制面
npm run executor                     # 执行机（rm executor/.node-uuid.lock 先）

# 引擎驱动
D:/anaconda3/python.exe tmp/kb_i5_usage24_drill.py   # 最新全链驱动（改 tid/sid 段）

# 验证
./python/python.exe scripts/characterization/characterize-*.py   # pin 全家福
```

- 截图/报告归档：`tmp/e2e/shots/`、`tmp/kb_i5_usage*_report.md`
- 知识卡：`data/kb/flows/*.json`（24 张，credit_usage 13 rules 为最全）
- 关联文档：`docs/superpowers/research/2026-09-01-e2e-chain-a.md`（链 A/B 全景）、`tmp/e2e/chain_a_anchor.md`（接续锚点）、`tmp/e2e/r10b_report.md`（七模块配方）、`tmp/e2e/r8a_report.md`（三道闸+意见页）
