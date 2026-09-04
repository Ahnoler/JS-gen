# 引擎自主闭环·阶段总结与下一阶段计划（2026-09-05）

> 上一阶段（P1/P2 冲刺）收尾文档：`2026-09-04-engine-closure-handover.md`（配方/定案档案，仍有效）。
> 本文是阶段总结 + 经验沉淀 + 下一阶段（P3 起）目标与排期。

## 1. 阶段成果盘点（截至 2026-09-05 03:30）

| 项 | 结果 |
|---|---|
| P1 引擎自主闭环 | ✅ YXPC20260905012040 纯引擎提交进审批（tid=505，run26→26j 六轮驱动迭代） |
| P2 批量自批第二波 | ✅ 12040/032 全通过，批复 DGYXPF202609050016008/009 已生效（**累计 8 笔批复**：…004-007 + 008/009 + 冻结链） |
| 引擎侧代码 | ✅ commit `0f80d3c`：introduce_guarantor VERIFY 收紧（dialog 表排除+关系单元格校验）+ xhr_log requestBody 捕获 + pin×2 更新 + 提示词同步 |
| 驱动配方 | ✅ run26* 六轮根因链全套实证（tmp/kb_i5_usage26*_report.md），`radio_ensure→持久化三段`（CDP checked→就近保存→请求体核对）成为担保闸金标准 |
| 盛达草稿清理 | ⚠️ 定案：SUT deleteBefore 钩子对待发起半成品静默拒绝，前端不可删，8 笔保留（12031/033-039） |

## 2. 经验总结（本阶段沉淀的工程模式）

1. **持久化金标准三段式**：UI 状态（radio is-checked）→ 分区保存点击 → **保存请求体核对**（read_xhr_log requestBody）。任何一段单独通过都不算数——run24 四轮 NextCheck 被拒就是只有 UI 段的假绿。requestBody 捕获（0f80d3c）是本阶段最重要的基建。
2. **点击通道按控件类型分流**：`el-button`（分区保存/工具栏）走 JS 合成 `b.click()`；`tsscBtn`（引入保证人/确认）必须 CDP trusted click；**残留 tsscMutilDialog 空壳 + 孤儿 `.v-modal` mask 会拦截一切坐标点击**——关键操作前必跑清障（JS_CLEAR_MASKS2，含孤儿 mask）。
3. **复杂控件写入通道阶梯**（按组件形态递进）：fill_form_field → select_option → set_vue_model（radio/下拉坐标打不开时）→ **Vue `$emit('input',…)` 直写**（daterange 唯一有效通道）→ CDP 键盘（仅作试验对照）。native setter 对 Element UI 的 daterange/disabled+刷新型控件无效。
4. **分区保存按钮要按 header 关键词定位**（save_click_v3）：从字段爬祖先找「带保存按钮且 header 含关键词」的层——depth 最浅的 el-form 保存常是跨分区校验的错误按钮（run26e 实证触发全表单错误）。
5. **只读监控脚本模式**（`tmp/r26_monitor.py`）：驱动跑动中用 CDP 只读探测 formErrors/分区结构，实时发现「还剩哪几个必填」——比事后翻日志定位快一倍，两次直接改写修法。建议固化为排障标准动作。
6. **gate 判定纪律**：NextCheck 的 reason=「操作成功」必须判过闸（run26i 就差一步）。拒绝原因是一整段含多模块名的文本时，救援循环要按类别去重派发**全量字段块**（部分补填必被表单校验拦，run26c 教训）。
7. **多账号流程推进**：定人审批链用账号切换分批处理（WN0001 二次调查/审批 → 701994 审查+选人黄亮 → WN0001 终批）。页面懒渲染 8-10s（004 意见区块）与详情页渲染失败（btnoNo undefined）重进即可。
8. **假阳性防线**：VERIFY 类后校验必须排除弹窗内同构表（closest 判定）+ 交叉校验业务列值（关系单元格）——「表头特征相同 ≠ 同一张表」。

## 3. 下一阶段目标（P3 起，按优先级）

### P3 链 B 打通（业务完整性，预估 1-2h）
- 135292（张某某）登录 → 待办「对公授信申请二次调查 PJ20260901016003」→ 是否上报=否 → 流程操作=下一步（定人链，可能需黄亮接力）
- 评级生效后 → 授信 DGSX20260901056031 解锁 → 继续链 B（授信向导深链，KB-I5 引擎五缺口已修，见 `2026-08-31-api-drive-chain.md` §12）
- 验收：链 B 授信→用信全链一单走通，链 A/B 双线闭环

### P4 KB 扩卡 24→28（资产化，预估 0.5d，依赖 P3 无）
- run26 配方沉淀：`credit_usage` 卡补 利率四必填（intrtLvl/lprIntrt set_vue_model）、分区块保存 header 定位、有效期 $emit 直写、担保持久化三段
- 新卡候选：`rate_wizard`（利率测算弹窗+四必填）、`product_wizard`（产品 21 项+证照有效期）、`cleanup_limits`（deleteBefore 拒删结论）
- staging 晋升流程照 `promote.py --apply`

### P5 引擎环境缺口（自主性收口，预估 0.5d）
- prepare 的 login replay 加「已登录跳过」分支（交接 §3.3）
- 验证码处置定案（引擎无识别能力：人工识读通过 or 账号白名单）
- 701994 锁定窗口轮询（run24 已实证 CDP 自动登录可行，补解锁重试编排）
- 收口后单会话全自主复跑（登录→审批中零人工）作为「100% 自主」终验

### P6 挂起/按需（不动）
- A7 影像上传探索（用户暂缓）
- 押品模块（等 SUT 修 checkWrntTxNumb）、催收（无在途任务）
- SUT 缺陷清单整理提交（deleteBefore 静默拒绝、btnoNo undefined、i18n is not defined 等 10+ 条）——建议随下批联调一起给被测系统团队

## 4. 快速上手（接续命令）

```bash
D:/anaconda3/python.exe tmp/kb_i5_usage26_drill.py        # 全链驱动（run26 修正版，改 tid/sid 段）
D:/anaconda3/python.exe tmp/r26_monitor.py                 # 只读监控（formErrors/分区结构）
./python/python.exe scripts/characterization/characterize-introduce-guarantor.py   # pin
netstat -ano | grep ":4097" ; config/open-db-tunnel.cmd    # 环境
```

- run26 系列报告：`tmp/kb_i5_usage26{,b,c,d,e,f,g,h,i,j}_report.md` + `_run*.log`
- 知识卡：`data/kb/flows/*.json`（24 张）
- 批量自批配方：`tmp/e2e/batch_appr_report.md`（账号切换/懒渲染/选人候选池）
