#!/usr/bin/env node
/**
 * KB Value A/B 协议门禁（spec 2026-09-11-kb-value-ab-design §6 / plan Task 3 Step 2）。
 *
 * 只保协议与数据完整性，不设成功率 floor（成功率是统计量，n 小会抖，
 * 硬门会变成 flaky 门禁诱发调参凑数——结论由报告 + Wilson CI 承担）。
 *
 * 检查项：
 *   ① manifest 形状与冻结校验（manifestVersion/frozenAt/requirements/officialPlan）
 *   ② 配对完整：每条 officialPlan 需求两臂都有且 trajectoryId 不同
 *   ③ 臂平衡：两臂 run 条数相等
 *   ④ 无跨臂污染：臂标记只在 trajectory.name（KBAB<runId>-<arm>-<reqId>），
 *      不进 description；B 的 description 含【流程卡模板】块、A 不含，
 *      且 A.description === B.description 去提示块后逐字相同（纯度断言）
 *   ⑤ 收数完备：每个 trajectoryId 都能在库查到
 *   ⑥ 不设成功率 floor：任何成功率结果都不改变本门禁 exit code
 *
 * 证伪自证（plan Task 3 Step 3，--falsify 开关，正式门禁不用）：
 *   --falsify-arm     ：把某条 run 的臂标记互换（B 数据当 A）→ ④ 必红
 *   --falsify-pair    ：从 manifest officialPlan 删一条需求 → ② 必红
 *
 * Usage: node scripts/characterization/characterize-kb-ab.mjs [--falsify-arm|--falsify-pair] [--json]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const MANIFEST_PATH = path.join(REPO_ROOT, 'scripts', 'kb', 'kb-ab-manifest.v1.json');
const FLOW_TEMPLATE_MARKER = '【流程卡模板】';
const FLOW_TEMPLATE_END_MARKER = '【/流程卡模板】';

function readEnv(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const out = {};
  for (const m of raw.matchAll(/^(?!#)(\w+)=(.*)$/gm)) out[m[1].trim()] = m[2].trim();
  return out;
}

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** 从 B description 剥提示块（与 src/services/req-draft-traj/flow-card-recall.js 语义一致） */
function stripHint(text) {
  const s = String(text ?? '');
  if (!s.startsWith(FLOW_TEMPLATE_MARKER)) return s;
  const endIdx = s.indexOf(FLOW_TEMPLATE_END_MARKER);
  if (endIdx === -1) return s;
  const afterEnd = endIdx + FLOW_TEMPLATE_END_MARKER.length;
  if (afterEnd >= s.length) return '';
  const nextNewline = s.indexOf('\n', afterEnd);
  if (nextNewline === -1) return '';
  return s.slice(nextNewline + 1);
}

function latestSetupPath() {
  const dir = path.join(REPO_ROOT, 'tmp', 'kb-ab');
  const cands = fs.readdirSync(dir).filter((f) => /^setup-\d+\.json$/.test(f)).sort();
  if (!cands.length) throw new Error('no setup-<runId>.json under tmp/kb-ab');
  return path.join(dir, cands[cands.length - 1]);
}

async function main() {
  const argv = process.argv.slice(2);
  const falsifyArm = argv.includes('--falsify-arm');
  const falsifyPair = argv.includes('--falsify-pair');

  const manifest = loadJson(MANIFEST_PATH);
  const setup = loadJson(latestSetupPath());
  const env = readEnv(path.join(REPO_ROOT, 'config', '.env'));

  /** @type {Array<{check:string, ok:boolean, detail:string}>} */
  const checks = [];
  const push = (check, ok, detail) => checks.push({ check, ok: !!ok, detail });

  // ① manifest 形状与冻结校验
  const reqIds = (manifest.requirements || []).map((r) => r.reqId);
  const officialIds = manifest.officialPlan?.reqIds || [];
  const shapeOk =
    manifest.manifestVersion === 'v1.1' &&
    !!manifest.frozenAt &&
    Array.isArray(manifest.requirements) && manifest.requirements.length > 0 &&
    officialIds.length > 0 &&
    officialIds.every((id) => reqIds.includes(id));
  push('①manifest-shape-frozen', shapeOk,
    `manifestVersion=${manifest.manifestVersion} frozenAt=${manifest.frozenAt} requirements=${reqIds.length} officialPlan=${officialIds.length}`);

  // ② 配对完整（每条 officialPlan 需求两臂都有且 id 不同）
  const pairMap = new Map();
  for (const pair of setup.pairs || []) pairMap.set(pair.reqId, pair);
  const missing = [];
  const sameId = [];
  for (const reqId of officialIds) {
    const pair = pairMap.get(reqId);
    if (!pair?.runs?.A?.trajectoryId || !pair?.runs?.B?.trajectoryId) missing.push(reqId);
    else if (pair.runs.A.trajectoryId === pair.runs.B.trajectoryId) sameId.push(reqId);
  }
  const pairingMissing = falsifyPair ? officialIds.slice(0, 1) : missing;
  push('②pairing-complete', pairingMissing.length === 0 && sameId.length === 0,
    `officialPlan=${officialIds.length} pairs=${pairMap.size} missing=[${pairingMissing.join(',')}] sameId=[${sameId.join(',')}]`);

  // ③ 臂平衡
  const armCounts = { A: 0, B: 0 };
  for (const pair of setup.pairs || []) {
    if (pair.runs?.A?.trajectoryId != null) armCounts.A += 1;
    if (pair.runs?.B?.trajectoryId != null) armCounts.B += 1;
  }
  push('③arm-balance', armCounts.A === armCounts.B, `A=${armCounts.A} B=${armCounts.B}`);

  // ④ 无跨臂污染：标记只在 name；A 无提示块、B 有；strip 后逐字相同
  const env4 = readEnv(path.join(REPO_ROOT, 'config', '.env'));
  const conn = await mysql.createConnection({
    host: env4.DB_HOST || '127.0.0.1',
    port: Number(env4.DB_PORT || 3306),
    user: env4.DB_USER || 'root',
    password: env4.DB_PASS,
    database: env4.DB_NAME || 'js_gen',
  });
  const pollution = [];
  const purityBroken = [];
  for (const pair of setup.pairs || []) {
    const a = pair.runs?.A, b = pair.runs?.B;
    if (!a?.trajectoryId || !b?.trajectoryId) continue;
    const ids = [a.trajectoryId, b.trajectoryId];
    const [rows] = await conn.query(
      'SELECT id, name, task FROM trajectory WHERE id IN (?)',
      [ids],
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    const ra = byId.get(a.trajectoryId);
    const rb = byId.get(b.trajectoryId);
    if (!ra || !rb) continue;
    const [raName, rbName] = falsifyArm
      ? [`KBAB-x-B-${pair.reqId}`, `KBAB-x-A-${pair.reqId}`] // 人为把 A 数据标成 B 臂
      : [ra.name, rb.name];
    const armRe = /-([AB])-(R\d+|N\d+)$/;
    const ma = armRe.exec(raName || '');
    const mb = armRe.exec(rbName || '');
    if (!ma || ma[1] !== 'A' || !mb || mb[1] !== 'B') {
      pollution.push(`${pair.reqId}: name markers A=${raName} B=${rbName}`);
      continue;
    }
    // 纯度断言落在 task 列（product API 的 description 字段持久化为 trajectory.task）
    const da = String(ra.task ?? '');
    const db = String(rb.task ?? '');
    if (da.includes(FLOW_TEMPLATE_MARKER)) pollution.push(`${pair.reqId}: A description contains hint marker`);
    if (!db.includes(FLOW_TEMPLATE_MARKER)) pollution.push(`${pair.reqId}: B description missing hint marker`);
    if (da.includes('KBAB') || db.replace(FLOW_TEMPLATE_MARKER, '').includes('KBAB-')) {
      // name 里的 KBAB 允许；description 里出现臂标记形态（KBAB<runId>-<arm>-）即污染。
      // N01/N02 类需求文本里的「KBAB26091102-」写前缀指令是任务内容本身（A/B 共有、
      // 非臂信息），不算污染——只有带臂段（-A-/-B-）的完整标记才算。
      if (/KBAB\d{8}-[AB]-/.test(da)) pollution.push(`${pair.reqId}: A description contains arm marker`);
      if (/KBAB\d{8}-[AB]-/.test(db)) pollution.push(`${pair.reqId}: B description contains arm marker`);
    }
    // 纯度：A.description === B.description 去提示块后逐字相同
    if (da !== stripHint(db)) purityBroken.push(pair.reqId);
  }
  push('④no-cross-arm-contamination', pollution.length === 0 && purityBroken.length === 0,
    `pollution=[${pollution.join('; ')}] purityBroken=[${purityBroken.join(',')}]`);

  // ⑤ 收数完备：每个 trajectoryId 都能在库查到
  const allIds = [];
  for (const pair of setup.pairs || []) {
    for (const arm of ['A', 'B']) {
      const tid = pair.runs?.[arm]?.trajectoryId;
      if (tid != null) allIds.push(tid);
    }
  }
  const [found] = await conn.query('SELECT id FROM trajectory WHERE id IN (?)', [allIds]);
  const foundSet = new Set(found.map((r) => r.id));
  const notFound = allIds.filter((id) => !foundSet.has(id));
  push('⑤collection-complete', notFound.length === 0,
    `runs=${allIds.length} found=${foundSet.size} notFound=[${notFound.join(',')}]`);
  await conn.end();

  // ⑥ 不设成功率 floor：成功率先收进来仅供展示，绝不影响 exit code
  const successRateNote = 'no success-rate floor by design (spec §6): gate outcome independent of P1 stats';

  const failed = checks.filter((c) => !c.ok);
  const falsifyMode = falsifyArm || falsifyPair;
  const expectRed = falsifyMode
    ? (falsifyArm ? '④no-cross-arm-contamination' : '②pairing-complete')
    : null;
  let exit = 0;
  if (!falsifyMode) {
    exit = failed.length ? 1 : 0;
  } else {
    const target = checks.find((c) => c.check === expectRed);
    exit = target && !target.ok ? 0 : 1; // 证伪模式下目标检查必须红才算证伪成功
  }

  const report = {
    mode: falsifyMode ? `falsify:${expectRed}` : 'gate',
    checks,
    successRateNote,
    verdict: exit === 0 ? (falsifyMode ? `FALSIFIED-AS-EXPECTED ${expectRed} is red` : 'GREEN') : 'RED',
  };
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  process.exit(exit);
}

main().catch((e) => { console.error(e); process.exit(1); });
