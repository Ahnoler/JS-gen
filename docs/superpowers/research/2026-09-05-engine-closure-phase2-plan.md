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


## 5. P3 链 B 打通·执行记录（2026-09-05 补记，MCP 有头浏览器配方）

- **P3.1 评级二次调查**：135292(张某某) 登录 → 待办 PJ20260901016003 → 审批 → 流程操作=「同意」（评级链选项为 同意/不同意/退回，非下一步）→ 意见填写 → 流程提交 →「流程到此结束」确认。**评级流程在二次调查节点单节点终结**。
- **P3.2 评级生效核验**：701994 视角评级列表 PJ20260901016003=通过、评级 D、有效期 2027-08-19。**勘误**：交接文档所写「授信 DGSX20260901056031 解锁」有误——该单是盛达(链A客户)的授信且早已审批中，与链 B 无关；链 B 的正确下一步=为贯通验证企业新建授信。
- **P3.3 链 B 授信提交**：新增对公授信 → 业务主体选择(贯通验证 26090119045027429，管户经理黄某某) → 风险阻断通过（评级生效前置①+无在途前置②均满足）→ 授信方案（额度 100 万/期限 12 月/信用类押品字段填 0/占用余额点「获取占用余额」自动算）→ **额度分项列表新增分项（关键难点，见 §6）** → 影像→风险阻断→意见(流程操作=下一步)→ 流程提交 → 选人 客户经理-黄亮(WN0001) → **DGSX20260905056032 审批中**。

## 6. 分项额度明细·SUT 深坑实录（KB 卡 credit_application 已沉淀 3 条规则）

1. 分项额度名称组件=TsscMultiTree（体系树，接口 `/tansun-tcp-ulm/ulm/stmInf/getTree`，叶=授信品种 CP 编码）。其 nodeClickFun 存在 SUT 缺陷（serchHandel undefined NPE）导致**选中值不落 form model**，保存时后端报「授信产品编码不能为空」。
2. 绕行配方：fetch getTree 拿叶子编码 → 定位 ElFormItem.form.model 直接写 **crgPdNo(编码)/crgPdNm(名称文本)/rvlInd('0')/subCrgln/avlLmt** → TsscMultiTree.$emit('input', 编码) 让 UI 回显 → 移除保存按钮 disableBtn 类 → click。
3. **键名铁律**：分项的品种编码键是 `crgPdNo`（成功单 DGSX20260901056031 分项数据实证），不是 crgPdCd——错键后端报「授信产品编码不能为空」且不指明键名，只能靠成功数据反推。
4. 附带发现：编辑向导的「上一步」会**重置未保存的表单 UI 值**（native setter 写入的全部丢失）——关键字段必须 Playwright fill（真实键盘事件）或 Vue model 直写，且先保存再翻步。


## 7. P3 收官补记（2026-09-05 09:40）

- **WN0001 处理链 B 授信二次调查**（wf_credit_001_007，授信链比评级/用信链多此节点）：审批 → 流程操作=「同意」（选项=同意/不同意/退回第一环节）→ 意见 → 流程提交 →「流程到此结束」确认。
- **终态核验（701994 视角）**：授信列表 DGSX20260905056032=**通过**；对公授信批复列表 **DGSXPF20260905020004**（贯通验证企业/100 万/12 月/生效）自动生成。
- **链 B 主链全通**：评级申请→二次调查→评级生效→授信申请→授信二次调查→授信批复生效。剩余支线（授信项下用信/额度管控）配方已在 KB（credit_usage/limit），按需续跑。
- 节点谱系新知：授信审批链（wf_credit_001）节点序=001信贷调查(701994)→**007四/五级机构客户经理二次调查(WN0001，流程操作=同意，单节点终结)**——与用信链(002/003/004 三节点)不同。
