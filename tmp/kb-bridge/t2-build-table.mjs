/**
 * T2 Step 3: write data/kb/colloquial-bridge.json from the ADJUDICATED entry list.
 *
 * Grounding rule (G1): every final entry MUST match a record in tmp/kb-bridge/T2-verified.json
 * (by term + expand[0] + sourceKind); sourceRef/evidence are copied FROM THE POOL, never
 * hand-typed. The script exits non-zero on any ungrounded entry.
 *
 * Adjudication principles applied (manual pass over the 183 verified candidates):
 *  - drop pure fragments / sentence pieces / parenthetical cross-ref artifacts (not query words)
 *  - drop ultra-generic terms (新增/查询/审批/已生效/产品名称/启用/禁用/删除/修改/发布/角色/查询…)
 *  - drop subset pairs whose injected bigrams are all generic tails (管理/信息/配置/维护/申请…)
 *    — they add leak without signal; keep subset pairs with >=1 distinctive injected bigram
 *  - drop same-card long-form->longer-form pairs (term already matches the card fully)
 *  - drop rule/status phrases as expand (保证人不可重复, 版本后缀 -新版, 主页/大页面 junk)
 *  - keep true wording bridges: doc glosses (B), same-card short-form framings with
 *    distinctive head/tail (A), wet-test SUT-vs-doc drift pairs (C)
 *
 * Scope policy (v1): all entries scope:null — the frozen T3 harness (recall-eval.mjs)
 * passes no moduleKey, so scoped entries could never fire in the measurement; the
 * global-effect risk is covered by the term literal-presence precondition + the
 * zero-new-FP hard gate. The scope MECHANISM is pinned separately (see gate file).
 *
 * WARNING (F-5): re-running this script REWRITES data/kb/colloquial-bridge.json and
 * tmp/kb-bridge/T2-bridge.txt. The output MUST stay byte-identical to the archived
 * asset (status:'archived' + archiveNote/archivedSemantics below must never be lost) —
 * after a run, `git diff` on both targets must be EMPTY. If it is not, fix this
 * script, never the table. `entries` sha256 must remain eb4ec272… (67).
 *
 * Run: node tmp/kb-bridge/t2-build-table.mjs   (idempotent no-op vs the archived asset)
 */
import { readFileSync, writeFileSync } from 'node:fs';

const verified = JSON.parse(readFileSync('tmp/kb-bridge/T2-verified.json', 'utf8')).verified;
const index = new Map();
for (const e of verified) {
  if (e.expand.length !== 1) continue;
  index.set(`${e.sourceKind}|${e.term}|${e.expand[0]}`, e);
}

/* ---- adjudicated final list (see header for the ruling rationale) ---- */
const FINAL = [
  // A corpus-card: same-card short-form framings with distinctive injected bigrams
  ['corpus-card', '待办', '待办任务'],
  ['corpus-card', '入库申请', '档案入库申请'],
  ['corpus-card', '反委托', '反委托借据'],
  ['corpus-card', '委外清收', '委外清收登记'],
  ['corpus-card', '记账台账', '押品记账台账'],
  ['corpus-card', '批复查看', '授信批复查看'],
  ['corpus-card', '关联关系', '关联关系日志'],
  ['corpus-card', '过滤配置', '关联关系过滤配置'],
  ['corpus-card', '评级列表', '集团评级列表'],
  ['corpus-card', '额度列表', '集团额度列表'],
  ['corpus-card', '受托支付', '受托支付变更'],
  ['corpus-card', '电子签', '模拟电子签'],
  ['corpus-card', '保证人', '引入保证人'],
  ['corpus-card', '独立新增', '独立新增担保'],
  ['corpus-card', '注册并占用', '额度注册并占用'],
  ['corpus-card', '牵头行', '牵头行发起'],
  ['corpus-card', '参与行', '参与行发起'],
  ['corpus-card', '卡片库', '角色卡片库'],
  ['corpus-card', '角色切换', '机构角色切换'],
  ['corpus-card', '检查任务', '贷后检查任务'],
  ['corpus-card', '生成配置', '风险分类生成配置'],
  ['corpus-card', '脱期法配置', '脱期法配置矩阵'],
  ['corpus-card', '认定理由配置', '分类认定理由配置'],
  ['corpus-card', '表达式', '表达式编辑器'],
  ['corpus-card', '关联方案', '控制规则关联方案'],
  ['corpus-card', '一键失效', '规则一键失效及恢复'],
  ['corpus-card', '失效规则', '批量失效规则'],
  ['corpus-card', '生效规则', '批量生效规则'],
  ['corpus-card', '机构管理', '账务机构管理'],
  ['corpus-card', '机构撤并', '机构撤并登记'],
  ['corpus-card', '催收评分', '催收评分卡配置'],
  ['corpus-card', '流程提交', '审批意见流程提交'],
  ['corpus-card', '催收任务', '催收任务编号'],
  ['corpus-card', '对公授信', '新增对公授信管理'],
  ['corpus-card', '委托贷款', '委托贷款用信申请'],
  ['corpus-card', '二合一', '二合一用信申请'],
  ['corpus-card', '要素分组', '产品要素分组'],
  ['corpus-card', '公共要素', '产品公共要素'],
  ['corpus-card', '个性化要素', '产品个性化要素'],
  ['corpus-card', '签订合同', '待签订合同管理'],
  ['corpus-card', '签订合同', '已签订合同管理'],
  ['corpus-card', '撤诉', '撤诉申请'],
  ['corpus-card', '数据指标模板', '数据指标模板配置'],
  ['corpus-card', '数据指标库', '数据指标库配置'],
  ['corpus-card', '观察期白名单', '观察期白名单配置'],
  ['corpus-card', '集团客户', '集团客户管理'],
  ['corpus-card', '授信系数', '授信系数管理'],
  ['corpus-card', '催收策略', '催收策略配置'],
  ['corpus-card', '密码策略', '密码策略管理'],
  // B corpus-req-doc: doc glosses / renamed-module synonyms
  ['corpus-req-doc', '拨款系数', '拨款转换系数'],
  ['corpus-req-doc', '征信结果', '查看征信报告'],
  ['corpus-req-doc', '引入客户', '客户放大镜'],
  ['corpus-req-doc', '数标', '数据指标'],
  ['corpus-req-doc', '产品要素管理', '产品要素库'],
  ['corpus-req-doc', '流程跟踪信息主页', '流程轨迹弹窗'],
  ['corpus-req-doc', '弹审批意见窗', '签署意见'],
  ['corpus-req-doc', '退回', '打回'],
  ['corpus-req-doc', '影像信息', '公共影像组件'],
  ['corpus-req-doc', '组织管理', '路由管理'],
  // C wet-test-drift: SUT vs doc wording pairs (module + leaf in sourceRef)
  ['wet-test-drift', '权限移交', '权限转移'],
  ['wet-test-drift', '提交流程', '流程提交'],
  ['wet-test-drift', '对私客户管理', '个人客户管理'],
  ['wet-test-drift', '模板管理', '模板配置'],
  ['wet-test-drift', '对公放款管理', '对公放款申请'],
  ['wet-test-drift', '零售放款管理', '零售放款申请'],
  ['wet-test-drift', '贷款业务类型', '业务发生类型'],
  ['wet-test-drift', '风险分类默认配置', '风险默认分类配置'],
];

const entries = [];
const missing = [];
for (const [kind, term, expand] of FINAL) {
  const hit = index.get(`${kind}|${term}|${expand}`);
  if (!hit) { missing.push(`${kind}|${term}|${expand}`); continue; }
  const sourceRef = String(hit.sourceRef || '').replaceAll('\\\\', '/');
  entries.push({
    term,
    expand: [expand],
    scope: null,
    source: `${kind} ${sourceRef} — ${hit.evidence}`,
  });
}
if (missing.length > 0) {
  console.error('UNGROUNDED entries (not in verified pool):');
  for (const m of missing) console.error('  ' + m);
  process.exit(1);
}

const byKind = {};
for (const e of entries) {
  const k = e.source.split(' ')[0];
  byKind[k] = (byKind[k] || 0) + 1;
}
const ab = (byKind['corpus-card'] || 0) + (byKind['corpus-req-doc'] || 0);
const c = byKind['wet-test-drift'] || 0;
const n = entries.length;
if (n < 40 || n > 80) { console.error(`table size ${n} outside 40..80`); process.exit(1); }
if (ab / n < 0.6) { console.error(`A+B ratio ${(ab / n).toFixed(3)} < 0.6`); process.exit(1); }
if (c / n > 0.4) { console.error(`C ratio ${(c / n).toFixed(3)} > 0.4`); process.exit(1); }

const table = {
  bridgeVersion: 'v1',
  status: 'archived',
  builtFrom: ['corpus-card', 'corpus-req-doc', 'wet-test-drift'],
  buildDiscipline: '禁止使用 kb-recall-eval.* 的任何条目作为建表依据（建表期物理隔离）；候选经双向校验（纯语料 grep，禁跑匹配器）+ 人工裁决；零 import 召回模块',
  scopePolicy: 'v1 全表 scope=null：冻结度量 harness（recall-eval.mjs）无 moduleKey 入口，scoped 条目在 T3 度量中不可能触发，故 v1 不设 scope；全局生效风险由「term 必须字面出现于查询」前提 + T3 零新增 FP 硬门覆盖；scope 门控机制另由 characterize-flow-card-recall pin 与 T4 B5 证明保留',
  entries,
  // F-4/F-5: copied verbatim from the archived asset (data/kb/colloquial-bridge.json) —
  // never reword these; a drift here means the next run un-archives the table.
  archiveNote: '2026-09-10 T3 度量未达标（E 0.100<0.25；全新地面增量 0<4）→ 按计划跳过接线、本版不计成果；资产保留为无害（护栏全绿）但归档',
  archivedSemantics: 'archived：不得接线，仅作续跑基线（reviewer F-4：loadSynonyms 不读 status，本标记为文档性、无强制力；loader 加 status 过滤=口径变更，等 Lead 批）',
};
writeFileSync('data/kb/colloquial-bridge.json', JSON.stringify(table, null, 2) + '\n');

const funnel = {
  pool: 409,
  twoWayVerified: 183,
  nonSubsetSingleExpand: 44,
  finalTable: n,
  mix: { byKind, aPlusB: ab, c, abRatio: +(ab / n).toFixed(3), cRatio: +(c / n).toFixed(3) },
  note: '汇总裁决原则见本脚本（t2-build-table.mjs）头注释——为汇总规则非逐条理由；grounding 断言强制回溯池内记录；reviewer F-3 口径：规则批量裁决+快速人工过一遍（~7 分钟），B 类 10 条中 4 条真词法同义',
};
const report = { funnel, entries };
writeFileSync('tmp/kb-bridge/T2-bridge.txt', JSON.stringify(report, null, 1));
console.log(`table: ${n} entries  byKind=${JSON.stringify(byKind)}  A+B=${(ab / n).toFixed(3)} C=${(c / n).toFixed(3)}`);
