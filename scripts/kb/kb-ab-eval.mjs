#!/usr/bin/env node
/**
 * KB Value A/B 收数引擎（spec 2026-09-11-kb-value-ab-design §3 / plan Task 3）。
 *
 * 按 manifest（scripts/kb/kb-ab-manifest.v1.json）+ 装配产物（tmp/kb-ab/setup-<runId>.json）
 * 的 trajectory id 从库确定性收 P1–P6：
 *   P1 成功率   trajectory.record_status ∈ {recorded, completed} / is_successful（主判据）
 *   P2 成本     step_count / phase_count / 墙钟（created_at→updated_at 秒）
 *   P3 人工介入 trajectory_step.source='manual' 步数占比
 *   P4 返工     trajectory_step.error 非空步数
 *   P5 卡遵循度 visitedRegions（element_json.region_id 的 page 段）与卡 hash_markers 路由
 *              命中率 + click_button 文案与卡 nodes[].buttons 命中率
 *   P6 越界     卡上不存在的页面（visitedRegions 无一 marker 命中）数 + 写操作黑名单按钮命中数
 *
 * 口径（红线）：
 *   - P1 只认 DB（record_status / is_successful），不认 HTTP 回读；
 *   - aborted/retryOf 的 run 不在本引擎剔除（按 manifest/装配产物原样收数，剔除决策
 *     只能走 manifest.abortedRuns 白名单，报告层负责执行）——引擎是照相机不是裁判；
 *   - 确定性：同一输入连跑两次逐位一致（无 now()/随机/迭代序依赖；墙钟用 DB 差值）。
 *
 * Usage: node scripts/kb/kb-ab-eval.mjs [--setup tmp/kb-ab/setup-26091102.json] [--json]
 * DB 连接读 config/.env（DB_HOST/DB_PORT/DB_USER/DB_PASS/DB_NAME）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const MANIFEST_PATH = path.join(REPO_ROOT, 'scripts', 'kb', 'kb-ab-manifest.v1.json');
const FLOWS_DIR = path.join(REPO_ROOT, 'data', 'kb', 'flows');
const P1_OK_STATUSES = new Set(['recorded', 'completed']);

/** P6 写操作黑名单按钮（SUT 共享环境危险操作，spec §5 只做可回滚操作） */
const WRITE_BLACKLIST_BUTTONS = ['删除', '停用', '注销', '作废', '强制', '退回'];

function readEnv(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const out = {};
  for (const m of raw.matchAll(/^(?!#)(\w+)=(.*)$/gm)) out[m[1].trim()] = m[2].trim();
  return out;
}

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * region_id 形如 "page:http://…#/cstMgt/…/cpctMgtPg|main" → 提取 URL hash 段文本
 * @param {string} regionId region_id 原文
 * @returns {string} URL hash 段文本
 */
function regionKey(regionId) {
  const m = /region_id[":=]?\s*"?page:([^|"\n]+)/.exec(regionId || '');
  if (m) return m[1];
  const m2 = /page:([^|"\n]+)/.exec(regionId || '');
  return m2 ? m2[1] : String(regionId || '');
}

/**
 * visitedRegions：按步序聚合 element_json.region_id 的 page 段（去重、保序）
 * @param {Array<{step_number: number, element_json: string|null}>} steps step 行
 * @returns {Array<{key: string, stepNumber: number}>} 去重保序的 region 序列
 */
function visitedRegionsFromSteps(steps) {
  const out = [];
  for (const s of steps) {
    const key = regionKey(s.element_json || '');
    if (!key) continue;
    if (out.length && out[out.length - 1].key === key) continue;
    out.push({ key, stepNumber: s.step_number });
  }
  return out;
}

/**
 * P5 路由命中：visitedRegion.key 是否含卡 hash_markers 任一 marker（大小写不敏感）
 * @param {Array<{key: string}>} regions visitedRegions
 * @param {string[]} markers 卡 hash_markers
 * @returns {Array<{key: string}>} 命中 marker 的 region 子集
 */
function markerHits(regions, markers) {
  const hits = [];
  for (const r of regions) {
    const k = r.key.toLowerCase();
    if (markers.some((mk) => k.includes(String(mk).toLowerCase()))) hits.push(r);
  }
  return hits;
}

function stripElementJsonText(elementJson) {
  try {
    const ej = JSON.parse(elementJson || '{}');
    return String(ej.text || ej.attr?.text || '');
  } catch {
    return '';
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const setupArg = (() => {
    const i = argv.indexOf('--setup');
    return i >= 0 ? argv[i + 1] : null;
  })();
  const jsonFlag = argv.includes('--json');

  const setupPath = setupArg || (() => {
    const cands = fs.readdirSync(path.join(REPO_ROOT, 'tmp', 'kb-ab'))
      .filter((f) => /^setup-\d+\.json$/.test(f)).sort();
    if (!cands.length) throw new Error('no setup-<runId>.json under tmp/kb-ab');
    return path.join(REPO_ROOT, 'tmp', 'kb-ab', cands[cands.length - 1]);
  })();

  const manifest = loadJson(MANIFEST_PATH);
  const setup = loadJson(setupPath);
  const env = readEnv(path.join(REPO_ROOT, 'config', '.env'));

  const conn = await mysql.createConnection({
    host: env.DB_HOST || '127.0.0.1',
    port: Number(env.DB_PORT || 3306),
    user: env.DB_USER || 'root',
    password: env.DB_PASS,
    database: env.DB_NAME || 'js_gen',
  });

  // 装配产物 → 平面 run 列表（id、臂、需求、卡）
  const runs = [];
  for (const pair of setup.pairs || []) {
    const req = (manifest.requirements || []).find((r) => r.reqId === pair.reqId);
    for (const arm of ['A', 'B']) {
      const r = pair.runs?.[arm];
      if (r && r.trajectoryId != null) {
        runs.push({
          trajectoryId: r.trajectoryId, arm, reqId: pair.reqId,
          card: req?.card || null, name: r.name,
        });
      }
    }
  }

  const cardCache = new Map();
  const outRuns = [];
  for (const run of runs) {
    const [trajRows] = await conn.query(
      'SELECT id, name, record_status, is_successful, step_count, phase_count, created_at, updated_at FROM trajectory WHERE id = ?',
      [run.trajectoryId],
    );
    const traj = trajRows[0] || null;
    const [stepRows] = await conn.query(
      'SELECT step_number, action_type, source, error, element_json, params_json FROM trajectory_step WHERE trajectory_id = ? ORDER BY step_number',
      [run.trajectoryId],
    );

    // P1
    const recordStatus = traj?.record_status || null;
    const p1 = {
      recordStatus,
      isSuccessful: traj ? traj.is_successful : null,
      ok: recordStatus != null && P1_OK_STATUSES.has(recordStatus),
    };

    // P2（墙钟用 DB 两列差值，确定性）
    let wallS = null;
    if (traj?.created_at && traj?.updated_at) {
      wallS = Math.round((new Date(traj.updated_at) - new Date(traj.created_at)) / 1000);
    }
    const p2 = { stepCount: traj?.step_count ?? null, phaseCount: traj?.phase_count ?? null, wallS };

    // P3 / P4
    const total = stepRows.length;
    const manual = stepRows.filter((s) => s.source === 'manual').length;
    const errored = stepRows.filter((s) => s.error != null && String(s.error).trim() !== '').length;
    const p3 = { manualSteps: manual, totalSteps: total, ratio: total ? +(manual / total).toFixed(4) : null };
    const p4 = { errorSteps: errored, totalSteps: total };

    // P5 / P6（依赖卡；无卡 run 记 null）
    const regions = visitedRegionsFromSteps(stepRows);
    let p5 = null;
    let p6 = null;
    if (run.card) {
      const cardFile = path.join(FLOWS_DIR, `${run.card}.json`);
      const card = fs.existsSync(cardFile) ? loadJson(cardFile) : null;
      if (card) {
        const markers = card.hash_markers || [];
        const hits = markerHits(regions, markers);
        p5 = {
          visitedRegionCount: regions.length,
          markerHitRegionCount: hits.length,
          markerHitRatio: regions.length ? +(hits.length / regions.length).toFixed(4) : null,
        };
        // click_button 文案 vs 卡 nodes[].buttons
        const cardButtons = new Set(
          (card.nodes || []).flatMap((n) => n.buttons || []).map((b) => String(b).trim()),
        );
        const clickBtns = stepRows
          .filter((s) => s.action_type === 'click_button' || s.action_type === 'click_element_by_index')
          .map((s) => stripElementJsonText(s.element_json)).filter(Boolean);
        const btnHits = clickBtns.filter((t) => cardButtons.has(t.trim())).length;
        p5.clickButtonTexts = clickBtns.length;
        p5.clickButtonHits = btnHits;
        p5.clickButtonHitRatio = clickBtns.length ? +(btnHits / clickBtns.length).toFixed(4) : null;
        // P6 越界：visitedRegions 无一 marker 命中的独立页面段 + 写黑名单按钮命中
        const offCardRegions = regions.filter((r) => !markerHits([r], markers).length);
        const blacklisted = stepRows
          .map((s) => stripElementJsonText(s.element_json))
          .filter((t) => WRITE_BLACKLIST_BUTTONS.some((b) => (t || '').trim() === b));
        p6 = {
          offCardRegionCount: offCardRegions.length,
          offCardRegionKeys: offCardRegions.map((r) => r.key),
          blacklistButtonHits: blacklisted.length,
          blacklistButtonTexts: blacklisted,
        };
      }
    }

    outRuns.push({
      trajectoryId: run.trajectoryId,
      trajectoryName: run.name,
      reqId: run.reqId,
      arm: run.arm,
      card: run.card,
      P1: p1, P2: p2, P3: p3, P4: p4, P5: p5, P6: p6,
    });
  }

  await conn.end();

  // 每臂汇总（P1 主判据；差异与 CI 留给报告层）
  const summary = {};
  for (const arm of ['A', 'B']) {
    const armRuns = outRuns.filter((r) => r.arm === arm);
    const ok = armRuns.filter((r) => r.P1.ok).length;
    summary[arm] = { total: armRuns.length, success: ok, successRate: armRuns.length ? +(ok / armRuns.length).toFixed(4) : null };
  }
  const payload = {
    manifest: 'scripts/kb/kb-ab-manifest.v1.json',
    setup: path.relative(REPO_ROOT, setupPath).replace(/\\/g, '/'),
    manifestVersion: manifest.manifestVersion,
    runs: outRuns,
    armSummary: summary,
  };

  if (jsonFlag) process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  else {
    console.log(`KB A/B eval — manifest ${manifest.manifestVersion}, setup ${path.basename(setupPath)}`);
    for (const r of outRuns) {
      console.log(`#${r.trajectoryId} [${r.arm}] ${r.reqId} card=${r.card} P1=${r.P1.ok ? 'OK' : 'FAIL'}(${r.P1.recordStatus}) P2 steps=${r.P2.stepCount} wall=${r.P2.wallS}s P4 err=${r.P4.errorSteps}`);
    }
    console.log('armSummary:', JSON.stringify(summary));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
