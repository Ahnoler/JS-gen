# limit-ctrl-api 湿测证据表（额度-管控接口）

- SUT：http://test.creditv5p2.tansun.com.cn/ · 账号 701994/1 · 会话约 50 分钟过期
- 方法：Playwright MCP snapshot→click，逐叶导航验证；判词 match/drift/blocked/not-found（每行必含日期）；写操作黑名单：只读验证，禁止确认/提交/保存/作废/删除/冲正等一切业务落库动作，走到最终确认前一步即止
- 证据：截图存 `tmp/kb-wet-test/limit-ctrl-api/`（tmp 短寿命，文字证据为准）
- 章节出处：chapters/01~17（接口 1.1.1~1.1.17）；主链 C1~C5 见同目录 through-chains.md
- **协议检验注**：
  - **接口分册：页面叶缺失属源文档形态，判定以业务侧间接痕迹为准**——源文档所有接口「输出输入」均为「无」且全文无表格，报文字段口径整体缺失；全部 17 章原章末均无标准 ZJJK 清单行（均记「ZJJK：无」），湿测预备阶段已按存量回补条款逐章补写（格式 `接口号（接口名）`、以接口号替代 ZJJK 叶标识，名称取自章标题，无编造），见各章「ZJJK 清单（湿测预备回补）」。
  - 判定行按「章节=主链接口」建行（每接口一行，共 17 行）：B 组湿测的可验证对象=接口在 SUT 的**间接痕迹**（业务操作触发的额度登记/占用/释放结果，如经业务页面操作后用额度查询接口/额度台账核对落账），纯页面叶可能极少；查询类接口（1.1.9/1.1.10/1.1.11）若在 SUT 有可用入口（页面/工具）可作直接验证手段并兼作其他行断言。
  - 全册无 FS 场景号（fcnScnEcd/avyEcd）、无「同××」复用页——已 grep 核实，无复用页清单条款适用。
  - 原文无表格 ⇒ 各接口报文字段名/枚举（额度状态、校验标志、超额占用标志、释放剩余额度标志等）需湿测抓包建立，through-chains「通用待湿测」已列；预占用记账口径矛盾（1.1.6 按「已用金额」累计 vs 1.1.7「已用不变」）为最需验证项。
  - 建议测序（through-chains 优先级）：C5 查询核对 → C1 合同实占闭环 → C4 授用一体 → C2 预占闭环 → C3 限额闭环 → 旁路（1.1.2 试算 / 1.1.8 幂等同步）。

## 主链 1：合同实占闭环（chapters/01、03、04、05，4 行）

| # | 接口号 | 接口名 | 章节 | 判定 | 差异/证据 |
|---|--------|--------|------|------|-----------|
| 1 | 1.1.1 | 额度创建 | chapters/01 | match | 2026-09-06。SUT 交易码 `lmtRgst`（tansun-tcp-ulm），历史报文详情（查询交易信息→报文详情，样本 2026-09-05 09:31 成功）：请求 nodeList[{cstNo,cstNm,cstTp,ccy,lmtAmt,lmtEfdt,lmtExdt,lmtNo(DGQF…),nodeNo,rvlInd(循环标志),st(状态"1"),ddln,ddlnUnit}]，与文档规则1必填字段（客户编号/名称/类型/额度金额/币种/循环标志/生效/到期日期）一一对应；状态传"1"=生效与规则3一致；额度查询页可见按此创建的额度（EDBH20260803076002 等）=登记落账痕迹。历史窗口 1031 笔中 lmtRgst 成功 242/失败 1。错误原文：`DuplicateKeyException`（重复登记）。文档规则6（自动补父额度编号）、规则7（汇总额度递归同步）报文不可见，未验证但不影响判定 |
| 2 | 1.1.3 | 额度占用 | chapters/03 | match | 2026-09-06。SUT 交易码 `doOcp`（成功 178 笔/失败 8 笔）。成功样本（2026-09-02）请求含 bsnJrnlNo(业务流水号)、ctrNo(合同编号)、ctrAmt(合同金额)、esrAmt(敞口)、exrt(汇率)、oriCcy、nodeNo、cstNo/cstTp、abvqtOcpInd(超额占用标志"0")、crtInstNo/crtPsnNo——与文档规则1必填集一致；额度查询页可见占用后落账：许高 usedAmt=50,000/可用=450,000（额度 500,000），P农村小微 usedAmt=98,000——占用记账生效痕迹。失败原文（errInf）：`bsnInf对象的合同金额为空`（=规则1金额缺失报错中断）、`额度不存在，处理前请先检查额度是否存在为空`（=规则7生效校验）。「同一合同编号不能多次占用」（规则8）未取得重复占用样本，未验证 |
| 3 | 1.1.4 | 额度释放 | chapters/04 | match | 2026-09-06。SUT 交易码 `doOcpRevoke`（成功 2/失败 6）。成功样本（2026-08-13）：请求 {amt, bsnInf.ctrNo(合同编号), ctrSt, ccy, cstNo, rlseRsn:"发生展期释放额度", bsnJrnlNo, stmSrc}——按合同编号+释放金额+释放原因，与文档规则1/2（按合同编号释放）一致；rlseRsn 释放原因为文档未记载的报文字段（回填 chapters）。失败原文：`占用额度金额为空`（无占用汇总记录时拒绝，同规则2语义）。释放在额度查询页的反向痕迹：许高 额度500,000/已用50,000/可用450,000 即释放后余额状态。注意：SUT 措辞「Revoke」实为释放语义，冲正另有其码 `doReverse`——wording 级差异，已回填 chapters |
| 4 | 1.1.5 | 额度冲正 | chapters/05 | match | 2026-09-06。SUT 交易码 `doReverse`（成功 11/失败 5）。成功样本（2026-08-12）：请求 {bsnJrnlNo(本次冲正流水号), oriBsnJrnlNo(原业务流水号), hdlInst, hdlUser}——与文档规则1「原业务流水号+本次冲正流水号不能为空」完全对应。失败原文：`冲正时,原交易流水号HT20260624020099找不到流水记录`（=规则2按原流水查有效流水、找不到拒绝冲正）；另见一次后端 NPE 原文（java.lang.NullPointerException: …getOcpSeq()…Map.get null，内部缺陷痕迹，记录备查）。规则4-7（已冲正标记/金额回退公式）报文与台账未直接展示，未验证 |

## 主链 2：预占生命周期闭环（chapters/06、07，2 行）

| # | 接口号 | 接口名 | 章节 | 判定 | 差异/证据 |
|---|--------|--------|------|------|-----------|
| 5 | 1.1.6 | 额度预占用 | chapters/06 | blocked | 2026-09-06。写操作黑名单禁止主动调用；间接通道核查：查询交易信息全量 1031 笔历史报文（trdlog/list 全量枚举 2026-08~09 窗口）交易码分布为 doOcpCheck/doQotOccupyCheck/lmtRgst/doOcp/lmtRgstAndOcp/synGrpMemberRel/doOcpRevoke/batchQotRecalculationTrans/doReverse 九种——**无任何预占用交易码**（无 doPreOcp/preOcp 类），业务页面（查询占用信息页 0 条记录）亦无预占痕迹。补测条件=发生预占业务（外部系统调用预占用接口或经预占流程的业务单据）后经查询交易信息/额度台账核对记账口径（重点：已用金额 vs 预占金额归属，1.1.6/1.1.7 口径矛盾仍未解） |
| 6 | 1.1.7 | 额度预占转实占 | chapters/07 | blocked | 2026-09-06。同叶5：历史报文窗口 1031 笔无预占转实占交易码，占用侧只有直接实占 doOcp 与授用一体 lmtRgstAndOcp；查询占用信息页 0 条。补测条件=先发生预占用（叶5 补测完成后），再经业务流程转实占，核对「预占金额减少/实占金额增加/已用不变」与「释放剩余额度标志」行为 |

## 主链 3：限额闭环（chapters/13~17，5 行）

| # | 接口号 | 接口名 | 章节 | 判定 | 差异/证据 |
|---|--------|--------|------|------|-----------|
| 7 | 1.1.13 | 限额占用校验 | chapters/13 | match | 2026-09-06。SUT 交易码 `doQotOccupyCheck`（成功 270/失败 0，窗口内最高频）。成功样本（2026-09-05 14:37）请求：{txnsrlno(交易流水号), bsnObjNo(业务对象编号=合同号 LS…), bsnJrnlNo, cstNo, cstTp, ccy, txnamt(交易金额), exrt, pdNo(产品), wrntMod(担保方式"3"), ddln(期限), instNo(机构)}——维度字段（机构/产品/期限/担保方式）与文档规则3命中维度对应；exrt 直接传值（无汇率为空默认1的样本，规则2未直接验证）。成功 rspData="[]" 空=校验通过（无强/弱明细样本，规则6未验证）。该码与 doOcpCheck 成对出现在同一时刻（14:37:39/40）=同一业务动作先限额校验再额度校验的编排痕迹 |
| 8 | 1.1.14 | 限额占用 | chapters/14 | blocked | 2026-09-06。写操作黑名单禁止主动调用；间接通道核查：历史报文窗口 1031 笔中限额族仅有 doQotOccupyCheck（校验）与 batchQotRecalculationTrans（重算），**无限额占用正式交易码**（doQotOccupy 类缺位）——业务侧无已发生的限额占用落账可查。补测条件=开放 API 调用通道或发生触发限额占用的业务（如放款），经交易日志与限额台账核对组合限额/单户限额已用金额公式 |
| 9 | 1.1.15 | 限额释放 | chapters/15 | blocked | 2026-09-06。同叶8：历史窗口无限额释放交易码（限额占用本身无样本，释放无从发生）；额度侧释放为 doOcpRevoke，限额侧无对应码。补测条件=先发生限额占用（叶8 补测），再释放并核对「按业务对象编号逐限额编号释放」与流水生成 |
| 10 | 1.1.16 | 限额冲正 | chapters/16 | blocked | 2026-09-06。历史窗口冲正类仅 doReverse（额度冲正，叶4 已证），无限额冲正码样本；且限额占用/释放均无发生（叶8/9 blocked），冲正前置不成立。补测条件=限额占用→释放链路打通后再验冲正 |
| 11 | 1.1.17 | 限额重算 | chapters/17 | match | 2026-09-06。SUT 交易码 `batchQotRecalculationTrans`（成功 4/失败 0）。成功样本（2026-08-13）请求 {list:[{bsnObjNo(业务对象编号), cstNo, txnamt(重算交易金额), pdNo, wrntMod:"4", ddln, loanUseTp(贷款用途)}]}——与文档规则1必填（业务对象编号/客户编号/重算交易金额）对应，且**携带新维度字段**（pdNo/wrntMod/ddln/loanUseTp）=规则2「按新传入维度重新命中」的报文实证；loanUseTp 贷款用途为文档规则3维度清单中未列的字段（回填 chapters）。批量结构 list[]（接口名为 batch，文档未明示批量，观察记录）。与前笔 doOcpRevoke 同时刻成对（13:53:02/03）=「先释放原占用再重算」编排痕迹（规则2 恢复原占用语义）。金额回退公式不可只读验证 |

## 主链 4：授用一体（chapters/12，1 行）

| # | 接口号 | 接口名 | 章节 | 判定 | 差异/证据 |
|---|--------|--------|------|------|-----------|
| 12 | 1.1.12 | 额度注册并占用（授用一体） | chapters/12 | match | 2026-09-06。SUT 交易码 `lmtRgstAndOcp`（成功 52/失败 12）。成功样本（2026-08-15）请求三段结构 {lmtRgst:{crtInstNo创建机构, crtPsnNo创建人员, lmtList:[{cstNo,cstTp,lmtAmt,ccy,lmtNo,lmtNodeNo,lmtStdt,lmtExdt,ddln,ddlnUnit,rvlInd}]}, lmtOcp:{abvqtOcpInd, bsnInf:{ctrNo,ctrAmt,esrAmt,exrt,ccy,ctrSt,ctrStdt,ctrexpdt,pdNo,pdNm}, cstNo, nodeNo, multOcpCstList:[]}, verfInd:"1"}——lmtRgst/lmtOcp 双段=注册+占用一体；**verfInd 实测"1"=校验模式**（规则7 实证），lmtList 字段与规则2 必填集逐一吻合，lmtOcp 与规则4 必填集吻合。失败原文：`hdlUser经办人为空`——=规则1 创建机构/创建人员必传的强校验。规则8（校验结果汇总返回）响应 rspData="[]" 空校验明细=通过语义一致；规则10 回滚无失败后残留可查，未验证；verfInd="0"（正式模式）样本未见 |

## 主链 5：查询核对闭环（chapters/09、10、11，3 行）

| # | 接口号 | 接口名 | 章节 | 判定 | 差异/证据 |
|---|--------|--------|------|------|-----------|
| 13 | 1.1.9 | 额度查询（单笔） | chapters/09 | blocked | 2026-09-06。Lead 裁定：查询类接口无前端对外入口，判 blocked（补测条件=开放 API 调用通道）。间接能力存在：SUT 内部查询链 `tansun-tcp-ulm/ulm/lmtUseQuery/getCoreInfByIdTree`（按客户返回单额度体系全部节点含 EDBH20260803076002 主节点与 prnLmtNo 父额度编号、lmtAmt/avlAmt/usedAmt/frzAmt、lmtEfdt/lmtExdt、rvlInd、st）+ 额度详情页（FS00001644）展示单节点全字段——查询语义在内部通道等价可得，但对外单笔接口（按额度编号、未找到返回「数据不存在」校验错误）无法只读触发 |
| 14 | 1.1.10 | 额度列表查询 | chapters/10 | blocked | 2026-09-06。Lead 裁定 blocked（补测条件=开放 API 调用通道）。间接能力存在：额度查询统计→查询额度信息（FS00001644 列表页，avyEcd UML00012569）即等价的分页额度列表——默认自动加载 145 条（10条/页、15页），后端 `lmtUseQuery/findCoreInfGroup` 返回分页结构 {total,list[],pageNum,pageSize,pages…}（PageHelper 口径），行字段 cstNo/cstNm/cstTp/lmtAmt/avlAmt/usedAmt；支持客户编号/客户名称/客户类型筛选。行为对照：本页自动加载 vs 查询占用信息手动查询（见跨模块观察）。对外接口的查询条件组合（客户编号列表/批复编号/产品编号/查询类型等）与「三者均空拒绝」规则不可只读验证 |
| 15 | 1.1.11 | 节点列表查询 | chapters/11 | blocked | 2026-09-06。Lead 裁定 blocked（补测条件=开放 API 调用通道）。间接能力存在：①查询额度统计→查询额度体系页（4 tab：对公/零售/同业/集团额度体系=文档「额度体系类型」枚举的业务呈现），后端 `ulm/stmInf/list` 返回体系节点树（对公授信额度汇总节点 + 15 个子节点：房地产/固定资产/流动资金贷款额度、贴现、票据、保函、信用证、贸易融资、保理、资金业务等，各带 scnId 场景命中）；②额度详情页节点树 `lmtUseQuery/getCoreInfByIdTree` 返回 lmtNodeNo/nodeNm/prnLmtNo/rvlInd/st 等节点属性——「从额度体系节点表查询节点清单」语义成立。但对外接口过滤条件（末级节点标志/节点编号列表）不可只读验证；查询额度体系页 tab 面板可视化渲染为空（graph 组件未绘制，仅 API 有数据）记 behavior 观察 |

## 旁路（through-chains「旁路 / Out」，chapters/02、08，2 行）

| # | 接口号 | 接口名 | 章节 | 判定 | 差异/证据 |
|---|--------|--------|------|------|-----------|
| 16 | 1.1.2 | 额度占用校验（试算，不改数据） | chapters/02 | match | 2026-09-06。SUT 交易码 `doOcpCheck`（成功 191/失败 5，为 1031 笔窗口中最高频接口之一）。成功样本（2026-09-05 14:37）请求：{cstNo, cstTp, nodeNo, bsnJrnlNo, abvqtOcpInd:"0", bsnInf:{ctrNo, ctrAmt(合同金额=占用申请), esrAmt(敞口), exrt, oriCcy, ctrSt, ctrStdt, ctrexpdt, pdNo}, multOcpList:[]}——与文档规则1必填集（客户编号/节点编号/业务流水号/合同编号/合同金额/币种）对应，多占客户列表字段名实测为 multOcpList；成功响应 rspData=`[]`——空校验明细=校验通过（规则3实测吻合）；不改数据语义由「校验通过后额度台账无变化」间接成立（许高额度校验后 usedAmt 不变）。失败原文：`客户编号260610093437282160节点编号CP03988120251146的额度信息为空`——=规则4「按客户编号+节点编号查询额度，未找到拒绝」。规则5（生效未到期强校验）、规则6（可用金额上限）、规则8/9（折算公式）无对应用例，未验证 |
| 17 | 1.1.8 | 集团成员关系同步（幂等） | chapters/08 | match | 2026-09-06。SUT 交易码 `synGrpMemberRel`（44 笔全成功，无失败样本）。成功样本（2026-08-14）请求：{grpcstNo(集团客户编号), cstNo(成员客户编号), chgTp:"01"(变更类型), totGrpNo, totGrpMbrInd, tenantId}——与文档规则1必填（集团客户编号/成员客户编号/变更类型）对应，变更类型枚举实测 "01"（加入，推测，退出码未见样本）。幂等规则（规则2/3 重复忽略）无重复提交样本，未验证——但 44 笔连续成功无 DuplicateKey 异常（对照 lmtRgst 有 1 笔 DuplicateKeyException），与幂等设计相容。集团额度联动影响（待湿测项）未见报文痕迹 |

## 运行记录

- 会话：2026-09-06 10:35（登录态存活，剩余 50:00）开始，执行代理 Playwright MCP snapshot→click + Network 抓包 + 页面内只读 fetch（trdlog/list、trdlog/detail、lmtUseQuery/*、stmInf/list——全部只读查询通道，无任何写调用）。写操作零落库。

### 判定统计

- match：9（叶1、2、3、4、7、11、12、16、17）
- blocked：8（叶5、6、8、9、10、13、14、15）
- drift：0
- not-found：0
- pending：0

核心方法：本模块为纯接口分册，直接断言通道=「额度管控→额度查询统计→查询交易信息」的 TCP 交易日志（1031 笔历史报文含请求/响应/错误栈全文），辅以查询额度信息/额度详情页的额度落账反证。9 个历史交易码与 17 个接口的对应关系：

| SUT 交易码 | 对应接口 | 窗口计数（成功/失败） |
|---|---|---|
| lmtRgst | 1.1.1 额度创建 | 242 / 1 |
| doOcpCheck | 1.1.2 额度占用校验 | 191 / 5 |
| doOcp | 1.1.3 额度占用 | 178 / 8 |
| doOcpRevoke | 1.1.4 额度释放（SUT 命名 Revoke） | 2 / 6 |
| doReverse | 1.1.5 额度冲正 | 11 / 5 |
| （无） | 1.1.6 预占用 / 1.1.7 预占转实占 | 0 |
| synGrpMemberRel | 1.1.8 集团成员关系同步 | 44 / 0 |
| （无对外入口） | 1.1.9/1.1.10/1.1.11 查询类 | 内部通道存在 |
| lmtRgstAndOcp | 1.1.12 授用一体 | 52 / 12 |
| doQotOccupyCheck | 1.1.13 限额占用校验 | 270 / 0 |
| （无） | 1.1.14 限额占用 / 1.1.15 限额释放 / 1.1.16 限额冲正 | 0 |
| batchQotRecalculationTrans | 1.1.17 限额重算 | 4 / 0 |

后端 BizException 原文库（errInf 字段，湿测证据）：
- doOcp：`bsnInf对象的合同金额为空`；`额度不存在，处理前请先检查额度是否存在为空`
- doOcpCheck：`客户编号260610093437282160节点编号CP03988120251146的额度信息为空`
- doOcpRevoke：`占用额度金额为空`
- doReverse：`冲正时,原交易流水号HT20260624020099找不到流水记录`；另 1 笔 NPE：`java.lang.NullPointerException: Cannot invoke "...getOcpSeq()" because the return value of "java.util.Map.get(Object)" is null`
- lmtRgst：`DuplicateKeyException`（hutool 包装）
- lmtRgstAndOcp：`hdlUser经办人为空`

截图索引（tmp/kb-wet-test/limit-ctrl-api/，文字证据为准）：01-lmt-detail-node-fs00001644.png（额度详情节点全字段）、02-lmtRgst-msg-detail.png（额度创建报文）、03-trdlog-txn-list.png（交易日志列表）、04-lmt-system-tabs.png（额度体系 4 tab）。

### 跨模块观察

1. **错误归集**：本模块错误全部为后端 BizException（errInf 带完整 Java 栈），未见前端拦截层「调用search/diabf结果为false」族——接口分册页面（查询类）不经过业务校验前端层，与 credit-corp 等页面模块的 console 错误族无交集，非同族。
2. **列表加载行为相反对照**：同在「额度查询统计」子菜单下，查询额度信息/查询交易信息**默认自动加载**（145 条 / 1031 条），查询占用信息**默认不加载需手动查询**——同模块内两种行为并存，不可下钻为「额度管控模块自动加载」的普适规则。
3. **SUT 多出的文档未收录行为**：①释放接口 SUT 交易码为 `doOcpRevoke` 且带 `rlseRsn` 释放原因字段（如「发生展期释放额度」），文档 1.1.4 无此字段；②限额重算请求含 `loanUseTp`（贷款用途）维度，文档 1.1.13/14/17 维度清单未列；③查询额度体系页 4 个 tab（对公/零售/同业/集团）可视化面板渲染为空（API stmInf/list 有数据，前端 graph 未绘制）——疑似前端缺陷；④查询额度信息页顶部弹「最多可同时打开8个页面」提示（多页签工作台机制，属外壳行为）。
4. **协议疏漏观察**（供协议线参考）：①trdlog/list 分页接口无任何防重放/幂等说明也能全量翻页读取报文明文（含 rqsData），测试账号可越权看到其他经办人（WN0001/NN0003/NN0004/NN0005）的报文——湿测利用了该通道，但生产口径上或需权限收敛；②doOcpRevoke 失败样本 6 笔均「占用额度金额为空」，说明有外部系统在无占用时反复调释放，SUT 缺调用方校验提示；③额度使用流水区（额度详情页下方）恒为 0 条（两个有占用的客户均如此），占用明细只能在交易日志看——页面级流水查询疑似未接通或需单选节点后查询；④1.1.6/1.1.7（预占族）与 1.1.14~16（限额占用/释放/冲正）在测试环境完全无业务发生，接口存在性仅能由文档单源背书，建议补测台账登记。
