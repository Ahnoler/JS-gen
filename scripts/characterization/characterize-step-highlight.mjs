/**
 * Characterization: PR-LOC-HL 步骤级高亮数据层 + 渲染层（真实 DB 断言）。
 *   node scripts/characterization/characterize-step-highlight.mjs
 *
 * 读 traj 181 phase 3（phase id 675）+ screenshot #10615 真实数据，验证：
 *   - loadPhaseData / matchStepToElement / resolveStepBoxes 纯函数对真实数据的行为
 *   - 新数据（element_json 带 bbox）bbox 直用命中率；旧数据回退三维匹配由纯函数边界覆盖
 *   - 纯函数边界：空 label 仍可因 kind 命中、非法 rect 被滤、region 空维度跳过、
 *     全空维度按未匹配处理、AND 语义（任一非空维度必须全等）
 *   - buildHtml 渲染：全部步骤框（resolved 数）、badge 数量、虚线/实线类、
 *     列表行数 = steps 数（含无坐标置灰行）、coordX/coordY 坐标换算手算期望值
 *
 * 注意：锚点不硬编码。历史锚点两次失效（traj 38→157→181，均因 DB 数据清理被裁剪），
 * 2026-09-21 起改为动态锚点：每次运行从最近 40 张 phase_highlight 截图中选
 * 「bbox 直用命中 × 步数」最优的一张做真实数据断言。阈值按当前录制形态放宽
 * （阶段化录制后单阶段步数量级 ~15，旧全链路 27 步的锚点不再存在）。
 * 2026-09-21 晚补充两段式选优：湿测小轨迹（4 步纯 click 验收单）会把近 40 张池子
 * 稀释到无一张达 FLOORS——此时有界回溯（至多 400 张）找达标富锚；FLOORS 不放宽，
 * 回溯到底仍无达标仍判录制链真回归。
 */
import { getDB } from '../../config/database.js';
import {
  loadPhaseData,
  matchStepToElement,
  resolveStepBoxes,
  normalizeStep,
  isLegalRect,
  buildHtml,
  coordX,
  coordY,
} from '../tools/lightup-step-highlight.mjs';

const ANCHOR_SCAN = 40;
// 锚池回溯上限：近 40 张被小步数轨迹（如 4 步纯 click 湿测单）稀释时，向前回溯
// 找达 FLOORS 的富锚；回溯到底仍无达标 → 维持"录制链路未产出可用数据"的真回归判定。
// FLOORS 本身不放宽——回溯只解决"池子稀释"，不降低对锚点信息量的要求。
const ANCHOR_BACKSCAN = 400;
// 真实数据阈值下限：按动态锚点的预期量级设定（当前最优锚点 ~14 步 / 12 bbox 直用），
// 低于此值视为录制链路未产出可用 phase_highlight 数据，属真实回归。
const FLOORS = { elements: 1, steps: 10, json: 10, bbox: 10, solid: 10 };

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** 动态锚点：最近 ANCHOR_SCAN 张 phase_highlight 中选 bbox 直用命中×步数最优的一张；
 *  若近窗无一张达 FLOORS（池子被小步数轨迹稀释），有界回溯至 ANCHOR_BACKSCAN 张找
 *  达标富锚中评分最优者。 */
async function pickAnchor(db) {
  const evaluate = async (s) => {
    const data = await loadPhaseData(db, { screenshotId: s.id });
    const elements = (data.meta?.elements || []).filter((e) => e && e.rect);
    if (!elements.length || !data.steps.length) return null;
    const resolved = resolveStepBoxes(data.steps, data.meta.elements);
    const bboxHits = resolved.filter((r) => r.boxes[0]?.source === 'bbox').length;
    const jsonSteps = data.steps.filter((st) => st.hasElementJson).length;
    const qualified =
      data.steps.length >= FLOORS.steps &&
      jsonSteps >= FLOORS.json &&
      bboxHits >= FLOORS.bbox;
    const score = bboxHits * 10000 + data.steps.length * 100 + elements.length;
    return { shotId: s.id, trajId: s.trajectory_id, phaseId: s.trajectory_phase_id, score, qualified };
  };
  const scanBatch = (beforeId, limit) => {
    const q = db('screenshot').where({ kind: 'phase_highlight' }).orderBy('id', 'desc').limit(limit);
    return beforeId ? q.where('id', '<', beforeId) : q;
  };
  let best = null;        // 近窗内评分最优（不问达标）——保底与旧行为一致
  let qualifiedBest = null; // 达标锚中评分最优
  let lastId = null;
  let scanned = 0;
  let backscanned = false;
  while (scanned < ANCHOR_BACKSCAN) {
    const batch = await scanBatch(lastId, scanned === 0 ? ANCHOR_SCAN : 100);
    if (!batch.length) break;
    lastId = batch[batch.length - 1].id;
    scanned += batch.length;
    if (scanned > ANCHOR_SCAN) backscanned = true;
    for (const s of batch) {
      const r = await evaluate(s);
      if (!r) continue;
      if (!best || r.score > best.score) best = r;
      if (r.qualified && (!qualifiedBest || r.score > qualifiedBest.score)) qualifiedBest = r;
    }
    if (qualifiedBest) break; // 达标即止：近窗优先，回溯批内首个达标批也够用
  }
  const chosen = qualifiedBest || best;
  assert(!!chosen, `最近 ${Math.min(scanned, ANCHOR_BACKSCAN)} 张 phase_highlight 截图中无带元素+步骤的锚点 — DB 锚点数据缺失或录制链路未产出 phase_highlight`);
  assert(qualifiedBest, `回溯 ${scanned} 张仍无达 FLOORS（steps/json/bbox ≥10）的锚点 — 录制链路未产出可用 phase_highlight 数据，属真实回归`);
  if (backscanned) {
    console.log(`  锚池稀释：近 ${ANCHOR_SCAN} 张无达 FLOORS 锚点，回溯至第 ${scanned} 张命中富锚`);
  }
  console.log(`  anchor: shot #${chosen.shotId} (traj ${chosen.trajId} phase ${chosen.phaseId}), score=${chosen.score}`);
  return chosen;
}

async function testRealDataLoad(db, anchor) {
  const data = await loadPhaseData(db, { trajectoryId: anchor.trajId, phaseId: anchor.phaseId, screenshotId: anchor.shotId });
  assert(data.screenshotId === anchor.shotId, `screenshotId=${data.screenshotId} must be ${anchor.shotId}`);
  assert(data.meta && Array.isArray(data.meta.elements), 'meta.elements must be an array');
  assert(data.meta.elements.length >= FLOORS.elements, `elements=${data.meta.elements.length} >= ${FLOORS.elements}`);

  const steps = data.steps;
  const jsonSteps = steps.filter((s) => s.hasElementJson);
  const bboxSteps = steps.filter((s) => isLegalRect(s.bbox));
  console.log(`  steps total=${steps.length} | json=${jsonSteps.length} | bbox=${bboxSteps.length} | elements=${data.meta.elements.length}`);
  assert(steps.length >= FLOORS.steps, `steps total=${steps.length} >= ${FLOORS.steps}`);
  assert(jsonSteps.length >= FLOORS.json, `json steps=${jsonSteps.length} >= ${FLOORS.json}`);
  return { steps, elements: data.meta.elements };
}

async function testRealDataMatch(db, { steps, elements }) {
  const resolved = resolveStepBoxes(steps, elements);
  assert(resolved.length === steps.length, 'resolveStepBoxes returns one entry per step');

  const jsonSteps = steps.filter((s) => s.hasElementJson);
  const hitSteps = resolved.filter((r) => r.boxes.length > 0);
  const matchHits = hitSteps.filter((r) => r.boxes[0]?.source === 'match');
  const bboxHits = hitSteps.filter((r) => r.boxes[0]?.source === 'bbox');

  console.log(`  bbox direct=${bboxHits.length} | fallback match=${matchHits.length} | unmatched=${jsonSteps.length - hitSteps.length}`);
  // 动态锚点按 bbox 直用命中优选，命中应走 bbox 直用路径（新链路 element_json 带 bbox）
  assert(bboxHits.length >= FLOORS.bbox, `bbox direct hits=${bboxHits.length} >= ${FLOORS.bbox}`);
  assert(matchHits.length + bboxHits.length === hitSteps.length, `match+bbox cover all hits (${matchHits.length}+${bboxHits.length}=${hitSteps.length})`);
}

async function testScreenshotSelection(db, anchor) {
  // 传 screenshotId 直查
  const byId = await loadPhaseData(db, { screenshotId: anchor.shotId });
  assert(byId.screenshotId === anchor.shotId, 'screenshotId direct query');
  // 未传 phaseId 时从 screenshot 行 trajectory_phase_id 反查
  assert(byId.steps.length >= FLOORS.steps, `phase derived from screenshot: steps=${byId.steps.length}`);

  // kind='phase_highlight' + trajectory_id 按 id 倒序取第一条
  // （动态锚点未必是该 traj 最新一张，故与直查 DB 的最新一张对账，而非锚点本身）
  const latest = await db('screenshot')
    .where({ trajectory_id: anchor.trajId, kind: 'phase_highlight' })
    .orderBy('id', 'desc')
    .first();
  const byTraj = await loadPhaseData(db, { trajectoryId: anchor.trajId });
  assert(byTraj.screenshotId === Number(latest.id), `latest phase_highlight for traj ${anchor.trajId} = #${byTraj.screenshotId}`);

  // + 可选 phaseId：与直查 DB 的该 (traj, phase) 最新一张对账
  const byPhase = await loadPhaseData(db, { trajectoryId: anchor.trajId, phaseId: anchor.phaseId });
  const forPhase = await db('screenshot')
    .where({ trajectory_id: anchor.trajId, trajectory_phase_id: anchor.phaseId, kind: 'phase_highlight' })
    .orderBy('id', 'desc')
    .first();
  assert(byPhase.screenshotId === Number(forPhase.id), `traj+phase screenshot = #${byPhase.screenshotId}`);
  assert(byPhase.steps.length >= FLOORS.steps, `traj+phase steps=${byPhase.steps.length}`);

  // 不存在的 screenshot → 空返回
  const none = await loadPhaseData(db, { screenshotId: 999999999 });
  assert(none.screenshotId === null && none.steps.length === 0, 'missing screenshot → empty result');
}

function testPureBoundaries() {
  const legal = { x1: 0, y1: 0, x2: 100, y2: 20 };

  // 1. 空 label 的 step 仍可因 kind 命中（AND：label 维度为空则跳过）
  const byKind = matchStepToElement(
    { label: '', kind: 'button', regionId: '' },
    [{ label: '其他控件', kind: 'button', rect: legal }],
  );
  assert(!!byKind && byKind.kind === 'button', 'empty label + matching kind → hit');

  // 2. 非法 rect（x2<=x1）的元素被跳过，取下一个合法 rect 元素
  const illegal = { x1: 0, y1: 0, x2: 0, y2: 20 }; // x2 <= x1
  const skipped = matchStepToElement(
    { label: '保存', kind: 'button', regionId: '' },
    [
      { label: '保存', kind: 'button', rect: illegal },
      { label: '保存', kind: 'button', rect: legal },
    ],
  );
  assert(!!skipped && isLegalRect(skipped.rect), 'illegal rect element skipped → second legal element hit');

  // 3. region 维度为空时跳过（旧数据 region_id 为空不影响匹配）
  const noRegion = matchStepToElement(
    { label: '客户编号', kind: 'form_input', regionId: '' },
    [{ label: '客户编号', kind: 'form_input', regionId: 'titlebox:基本信息', rect: legal }],
  );
  assert(!!noRegion, 'empty regionId dim skipped → still matches');

  // 4. 全空维度按未匹配处理（design 约定）
  const allEmpty = matchStepToElement(
    { label: '', kind: '', regionId: '' },
    [{ label: '客户编号', kind: 'form_input', regionId: '', rect: legal }],
  );
  assert(allEmpty === null, 'fully-empty step → unmatched');

  // 5. AND 语义：任一非空维度必须全等，否则不命中
  const kindMismatch = matchStepToElement(
    { label: '保存', kind: 'button', regionId: '' },
    [{ label: '保存', kind: 'form_input', rect: legal }],
  );
  assert(kindMismatch === null, 'label matches but kind differs → null (AND)');

  const labelMismatch = matchStepToElement(
    { label: '保存', kind: 'button', regionId: '' },
    [{ label: '提交', kind: 'button', rect: legal }],
  );
  assert(labelMismatch === null, 'label differs → null (AND)');

  const regionMismatch = matchStepToElement(
    { label: '客户编号', kind: 'form_input', regionId: 'titlebox:基本信息' },
    [{ label: '客户编号', kind: 'form_input', regionId: 'titlebox:其他', rect: legal }],
  );
  assert(regionMismatch === null, 'regionId differs → null (AND)');

  // 6. 同 label 命中多个元素 → 取第一个 rect 合法的
  const firstWins = matchStepToElement(
    { label: '客户名称', kind: 'form_input', regionId: '' },
    [
      { label: '客户名称', kind: 'form_input', regionId: '', rect: legal },
      { label: '客户名称', kind: 'form_input', regionId: '', rect: { x1: 200, y1: 0, x2: 300, y2: 20 } },
    ],
  );
  assert(firstWins && firstWins.rect.x2 === 100, 'same label multiple elements → first legal rect wins');

  // 7. resolveStepBoxes：bbox 直用 / 无 bbox 走 match / 未命中空 boxes
  const withBbox = normalizeStep(
    { id: 1, action_type: 'fill_form_field', params_json: { label: '姓名' }, element_json: { bbox: { x1: 1, y1: 2, x2: 101, y2: 22 }, text: '姓名' } },
    0,
  );
  const resolved = resolveStepBoxes(
    [
      withBbox,
      { ...normalizeStep({ id: 2, action_type: 'click_element_by_index', params_json: null, element_json: { text: '保存', target_kind: 'button' } }, 1) },
      { ...normalizeStep({ id: 3, action_type: 'click_element_by_index', params_json: null, element_json: null }, 2) },
    ],
    [{ label: '保存', kind: 'button', rect: legal }],
  );
  assert(resolved[0].boxes.length === 1 && resolved[0].boxes[0].source === 'bbox', 'bbox direct');
  assert(resolved[1].boxes.length === 1 && resolved[1].boxes[0].source === 'match', 'fallback match');
  assert(resolved[2].boxes.length === 0, 'unmatched step → empty boxes');

  // 8. normalizeStep：label 优先级 formLabel > text > matchedLabel；params 归一化
  const ns = normalizeStep(
    { id: 4, action_type: 'fill_form_field', params_json: '{"value":"张三"}', element_json: { formLabel: ' 姓名 ', text: '占位', matchedLabel: 'X', bbox: { x1: 1, y1: 1, x2: 1, y2: 2 } } },
    3,
  );
  assert(ns.label === '姓名', `label from formLabel (trim), got "${ns.label}"`);
  assert(ns.params && ns.params.value === '张三', 'params parsed from string JSON');
  assert(ns.bbox === null, 'illegal bbox (x2==x1) dropped');

  const ns2 = normalizeStep(
    { id: 5, action_type: 'x', params_json: null, element_json: '{"text":"菜单","target_kind":"menu"}' },
    4,
  );
  assert(ns2.label === '菜单' && ns2.kind === 'menu' && ns2.hasElementJson, 'element_json string parsed');
  assert(ns2.params === null, 'null params_json → params null');

  const ns3 = normalizeStep({ id: 6, action_type: 'x', params_json: 'not-json', element_json: 'bad{' }, 5);
  assert(ns3.hasElementJson === false && ns3.params === null, 'parse failure → no element json, params null');
}

/** buildHtml 渲染（真实 DB 数据）。 */
async function testRenderRealData(db, anchor, { steps, elements }) {
  const resolved = resolveStepBoxes(steps, elements);
  const shot = await db('screenshot').where({ id: anchor.shotId }).first();
  // 锚点截图已迁 MinIO（image_data 为空）；渲染断言不依赖图片内容，用占位 base64
  const b64 = shot.image_data
    ? shot.image_data.toString('base64')
    : Buffer.from('placeholder').toString('base64');
  const data = await loadPhaseData(db, { trajectoryId: anchor.trajId, phaseId: anchor.phaseId, screenshotId: anchor.shotId });
  const html = buildHtml({ b64, meta: data.meta, resolved });
  const cw = Number(data.meta.contentWidth) || 1;

  const hitSeqs = [];
  resolved.forEach((r, i) => { if (r.boxes.length > 0) hitSeqs.push(i + 1); });

  // a. 每步至少一个 .box；badge 数量 = 有框步骤数
  const boxDivs = html.match(/<div class="box[^"]*" data-step="(\d+)"/g) || [];
  const boxSeqs = new Set(boxDivs.map((s) => Number(/data-step="(\d+)"/.exec(s)[1])));
  for (const seq of hitSeqs) assert(boxSeqs.has(seq), `step ${seq} must have a box`);
  const badgeCount = (html.match(/<span class="badge"/g) || []).length;
  assert(badgeCount === hitSeqs.length, `badge count=${badgeCount} must equal boxed steps=${hitSeqs.length}`);

  // b. 虚线/实线类：bbox 直用步骤 = 实线；fallback match 步骤 = 虚线
  const totalBoxes = boxDivs.length;
  const dashedBoxes = (html.match(/class="box dashed"/g) || []).length;
  const solidBoxes = totalBoxes - dashedBoxes;
  assert(totalBoxes >= 1, `html must contain boxes (got ${totalBoxes})`);
  assert(solidBoxes >= FLOORS.solid, `solid boxes (bbox direct) ${solidBoxes} >= ${FLOORS.solid}`);
  assert(dashedBoxes === totalBoxes - solidBoxes, `dashed/solid split consistent: ${dashedBoxes}/${solidBoxes}`);

  // c. 列表行数 = steps 数（含无坐标行），无坐标步骤置灰
  const rowCount = (html.match(/class="step-row/g) || []).length;
  assert(rowCount === steps.length, `step rows=${rowCount} must equal steps=${steps.length}`);
  const noBoxCount = steps.length - hitSeqs.length;
  if (noBoxCount > 0) {
    assert(html.includes('class="step-row no-box"'), 'unmatched steps must get no-box rows');
    const noBoxRows = (html.match(/class="step-row no-box"/g) || []).length;
    assert(noBoxRows === noBoxCount, `no-box rows=${noBoxRows} must equal unmatched steps=${noBoxCount}`);
  }

  // d. 坐标换算：buildHtml 框位置与 coordX/coordY（W=1400）一致
  const firstHit = hitSeqs.length ? resolved[hitSeqs[0] - 1] : null;
  if (firstHit) {
    const b = firstHit.boxes[0];
    const left = coordX(b.rect.x1, cw, 1400);
    const top = coordY(b.rect.y1, cw, 1400);
    const width = Math.max(2, coordX(b.rect.x2, cw, 1400) - left);
    const height = Math.max(2, coordY(b.rect.y2, cw, 1400) - top);
    const r = (v) => Math.round(v * 100) / 100;
    assert(html.includes(`left:${r(left)}px`), 'box left uses coordX conversion');
    assert(html.includes(`top:${r(top)}px`), 'box top uses coordY conversion');
    assert(html.includes(`width:${r(width)}px`), 'box width converted');
    assert(html.includes(`height:${r(height)}px`), 'box height converted');
  }

  // e. 图例含实线=bbox / 虚线=匹配 说明
  assert(html.includes('bbox') && html.includes('匹配'), 'legend labels present');
  console.log(`  steps=${steps.length} | boxes=${totalBoxes} (solid=${solidBoxes} dashed=${dashedBoxes}) | badge=${badgeCount} | rows=${rowCount} | contentWidth=${cw}`);
}

/** buildHtml 交互层（Task 3）：真实数据 HTML 含交互 script 与关键逻辑标记（字符串层面）。 */
async function testRenderInteraction(db, anchor) {
  const data = await loadPhaseData(db, { trajectoryId: anchor.trajId, phaseId: anchor.phaseId, screenshotId: anchor.shotId });
  const resolved = resolveStepBoxes(data.steps, data.meta.elements);
  const html = buildHtml({ b64: 'PLACEHOLDER', meta: data.meta, resolved });

  // a. 交互 <script> 块存在
  assert(html.includes('<script>') && html.includes('</script>'), 'html contains interactive <script> block');

  // b. 关键交互逻辑标记：筛选 / 透明度 / 步进 / 浮层 / Escape / 列表联动
  assert(html.includes('name="filter"'), 'filter radios (name="filter") present');
  assert(html.includes('data-source'), 'boxes carry data-source attr');
  assert(html.includes('opacity'), 'opacity slider present');
  assert(html.includes('step-prev') && html.includes('step-next'), 'stepper buttons step-prev/step-next');
  assert(html.includes('tooltip'), 'tooltip/detail overlay present');
  assert(html.includes('Escape'), 'Escape handler present');
  assert(html.includes('data-step') && html.includes('active'), 'list linkage via data-step query + active class');

  // c. 浮层字段标签（步骤号 / action / 标签 / 参数 / region / 来源）
  for (const label of ['步骤', 'action', '标签', '参数', 'region', '来源']) {
    assert(html.includes(label), `tooltip field label "${label}" present`);
  }
  console.log(`  interaction ok: script + filter/opacity/stepper/tooltip/Escape/linkage, resolved=${resolved.length}`);
}

/** buildHtml 渲染（纯函数边界 + 坐标换算手算期望值）。 */
function testRenderBoundaries() {
  // 1. 空 resolved → 仍可生成 HTML（不抛错），且交互 script / 控件仍存在
  const empty = buildHtml({ b64: 'dummy', meta: { contentWidth: 800, contentHeight: 600 }, resolved: [] });
  assert(typeof empty === 'string' && empty.includes('<!doctype html>'), 'empty resolved → html still generated');
  assert((empty.match(/class="step-row/g) || []).length === 0, 'empty resolved → no step rows');
  assert(empty.includes('<script>'), 'empty resolved → interaction script still present');
  assert(empty.includes('name="filter"'), 'empty resolved → filter radios present');
  assert(empty.includes('step-prev') && empty.includes('step-next'), 'empty resolved → stepper buttons present');
  assert(empty.includes('opacity'), 'empty resolved → opacity slider present');
  assert(empty.includes('tooltip') && empty.includes('Escape'), 'empty resolved → tooltip + Escape logic present');

  // 2. 坐标换算手算期望值
  assert(Math.abs(coordX(100, 800, 1200) - 150) < 1e-9, 'coordX: 100/800*1200 = 150');
  assert(Math.abs(coordY(40, 800, 1200) - 60) < 1e-9, 'coordY: 40/800*1200 = 60');
  assert(Math.abs(coordX(800, 800, 1200) - 1200) < 1e-9, 'coordX: contentWidth → displayWidth edge');
  assert(Math.abs(coordY(600, 800, 1200) - 900) < 1e-9, 'coordY: contentHeight → displayHeight edge');
  assert(Math.abs(coordX(0, 800, 1200) - 0) < 1e-9, 'coordX origin = 0');

  // 3. bbox 实线 + 徽标 N / match 虚线 + 徽标 NM / 无坐标 → no-box 行
  const legal = { x1: 0, y1: 0, x2: 100, y2: 20 };
  const html = buildHtml({
    b64: 'dummy',
    meta: { contentWidth: 800, contentHeight: 600 },
    resolved: [
      { step: { actionType: 'fill_form_field', label: '姓名' }, boxes: [{ rect: legal, source: 'bbox' }] },
      { step: { actionType: 'click_element_by_index', label: '保存' }, boxes: [{ rect: legal, source: 'match' }] },
      { step: { actionType: 'x', label: '无坐标' }, boxes: [] },
    ],
  });
  assert(html.includes('class="box" data-step="1"'), 'bbox box: no dashed class');
  assert(html.includes('border:2px solid hsl(47, 70%, 45%)'), 'bbox box: solid border seq1 color hsl(47,70%,45%)');
  assert(html.includes('class="badge" style="background:hsl(47, 70%, 45%)">1</span>'), 'bbox badge N with same-color background');
  assert(html.includes('class="box dashed" data-step="2"'), 'match box: dashed class');
  assert(html.includes('border:2px dashed hsl(94, 70%, 45%)'), 'match box: dashed border seq2 color hsl(94,70%,45%)');
  assert(html.includes('class="badge" style="background:hsl(94, 70%, 45%)">2M</span>'), 'match badge NM with M suffix');
  assert(html.includes('class="step-row no-box" data-step="3"'), 'no-coordinate step → no-box row');

  // 4. 可选 width：缺省 1400；传入时 stage 宽与坐标按 width 等比换算
  assert(html.includes('style="width:1400px;'), 'no width → stage defaults to 1400px');
  const wide = buildHtml({
    b64: 'dummy',
    meta: { contentWidth: 800, contentHeight: 600 },
    resolved: [{ step: { actionType: 'fill_form_field', label: '姓名' }, boxes: [{ rect: legal, source: 'bbox' }] }],
    width: 800,
  });
  assert(wide.includes('style="width:800px;'), 'width=800 → stage width 800px');
  assert(wide.includes('width:100px;'), 'width=800 → box width = 100/800*800 = 100px');
  assert(wide.includes('height:20px;'), 'width=800 → box height = 20/800*800 = 20px');
}

async function main() {
  console.log('\n=== step-highlight data layer characterization ===\n');
  const db = getDB();
  let failed = 0;
  const run = async (name, fn) => {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed += 1;
      console.error(`  ✗ ${name} — ${err.message}`);
    }
  };

  try {
    const anchor = await pickAnchor(db);
    console.log('[real data: dynamic anchor]');
    let ctx = null;
    await run('load data', async () => {
      ctx = await testRealDataLoad(db, anchor);
    });
    if (ctx) {
      await run('AND match rate + label hits', () => testRealDataMatch(db, ctx));
      await run('render html (real data)', () => testRenderRealData(db, anchor, ctx));
      await run('render interaction (real data)', () => testRenderInteraction(db, anchor));
    } else {
      failed += 1;
      console.error('  ✗ AND match rate — load data failed, skipped');
    }
    await run('screenshot selection', () => testScreenshotSelection(db, anchor));
    await run('pure function boundaries', testPureBoundaries);
    await run('render boundaries', testRenderBoundaries);
  } finally {
    await db.destroy();
  }

  console.log(failed ? `\nFAILED (${failed})\n` : '\nOK\n');
  process.exit(failed ? 1 : 0);
}

main();
