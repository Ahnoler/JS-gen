/**
 * 菜单 JSON 重复导入「九条更新规则」回归（真机 DB + 推送组包校验）。
 *
 * 规则对照（产品 08-27 / CHANGELOG 落地编号）：
 *  R1 快照：每次导入前落盘 system_menu_snapshot，menuVersion 递增
 *  R2 5.3 子菜单迁移：同 umlEcd 父级变化 → parent_id 迁移 + moved
 *  R3 5.4 交易跟随：trajectory.page_id 匹配新树 system_page → function_id 迁移
 *  R4 5.5 同 ID 改名：同 umlEcd 名称变化 → renamed
 *  R5 新增：新 umlEcd → created
 *  R6 5.7 同名收编：同父同型同名非 json_import → 写入 umlEcd/source=json_import + adopted
 *  R7 5.8 无交易删除：JSON 消失且无交易 → 物理删除 + deleted
 *  R8 5.8 有交易保留：JSON 消失但仍有交易 → 保留 + removedFlag=1
 *  R9 5.9 下线标记：消失节点 offline_marked（与 R8 配套；无交易者随后被 R7 删）
 *
 * Run: node scripts/characterization/characterize-menu-import-nine-rules.mjs
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { getDB } from '../../config/database.js';
import * as systemDao from '../../src/dao/system-dao.js';
import * as systemMenuSnapshotDao from '../../src/dao/system-menu-snapshot-dao.js';
import * as menuChangeLogDao from '../../src/dao/menu-change-log-dao.js';
import { NODE_TYPE } from '../../src/models/hierarchy-constants.js';
import { importMenuJson } from '../../src/services/menu-json-import.js';
import { buildMenuPushPayload } from '../../src/services/menu-push.js';
import { toPartnerMenuPushPayload } from '../../src/services/partner-platform.js';

const ECD = {
  MOD_RATE: 'UML_R9_RATE',
  MOD_CST: 'UML_R9_CST',
  MOD_GONE: 'UML_R9_GONE_MOD',
  FN_MOVE: 'UML_R9_FN_MOVE',       // rename+move (same node id)
  FN_TX_OLD: 'UML_R9_FN_TX_OLD',   // round1 owner of PAGE_TX → vanish
  FN_TX_NEW: 'UML_R9_FN_TX_NEW',   // round2 owner of PAGE_TX (different node)
  FN_KEEP: 'UML_R9_FN_KEEP',       // vanish with traj → keep offline
  FN_DEL: 'UML_R9_FN_DEL',         // vanish no traj → delete
  FN_NEW: 'UML_R9_FN_NEW',         // appear only in round2
  FN_ADOPT: 'UML_R9_FN_ADOPT',     // adopt onto manual sibling
  PAGE_MOVE: 'ZJJK_R9_MOVE',
  PAGE_TX: 'ZJJK_R9_TX',           // page that hops between functions (5.4)
  PAGE_KEEP: 'ZJJK_R9_KEEP',
  PAGE_DEL: 'ZJJK_R9_DEL',
  PAGE_NEW: 'ZJJK_R9_NEW',
  PAGE_ADOPT: 'ZJJK_R9_ADOPT',
};

function leaf(umlNm, umlEcd, pageId) {
  return {
    umlType: '2',
    umlNm,
    umlEcd,
    children: [{
      umlType: '3',
      name: `${umlNm}-活动`,
      managePage: { pdCmptEcd: pageId, pdCmptNm: `${umlNm}页`, resPath: `/r9/${umlEcd}` },
    }],
  };
}

function top(umlNm, umlEcd, children) {
  return { umlType: '2', umlNm, umlEcd, children };
}

function jsonBuf(roots) {
  return Buffer.from(JSON.stringify({ umlRelInfo: roots }));
}

function byEcd(nodes, ecd) {
  return nodes.find((n) => String(n.umlEcd || '') === ecd) || null;
}

async function insertTraj({ name, functionId, pageId }) {
  const db = getDB();
  const [id] = await db('trajectory').insert({
    name,
    task: 'nine-rules-regression',
    model: 'test',
    step_count: 0,
    phase_count: 0,
    is_done: 0,
    is_successful: 0,
    url: '',
    function_id: functionId,
    page_id: pageId,
    record_status: 'draft',
    persistent_record_status: 'draft',
  });
  return id;
}

async function cleanupSystem(systemId) {
  const db = getDB();
  const mods = await db('system').where({ parent_id: systemId }).select('id');
  const modIds = mods.map((m) => m.id);
  let fnIds = [];
  if (modIds.length) {
    const fns = await db('system').whereIn('parent_id', modIds).select('id');
    fnIds = fns.map((f) => f.id);
  }
  const allNodeIds = [systemId, ...modIds, ...fnIds];
  if (fnIds.length) {
    await db('trajectory').whereIn('function_id', fnIds).del();
  }
  await db('system_page').whereIn('system_node_id', allNodeIds).del();
  if (fnIds.length) await db('system').whereIn('id', fnIds).del();
  if (modIds.length) await db('system').whereIn('id', modIds).del();
  await db('system_menu_change_log').where({ system_node_id: systemId }).del();
  await db('system_menu_snapshot').where({ system_node_id: systemId }).del();
  await db('system').where({ id: systemId }).del();
}

async function listUnderSystem(systemId) {
  const all = await systemDao.listAll();
  const mods = all.filter((n) => Number(n.type) === NODE_TYPE.MODULE && Number(n.parentId) === Number(systemId));
  const modIds = new Set(mods.map((m) => Number(m.id)));
  const fns = all.filter((n) => Number(n.type) === NODE_TYPE.FUNCTION && modIds.has(Number(n.parentId)));
  return { all, mods, fns, nodes: [...mods, ...fns] };
}

async function main() {
  console.log('\n=== menu JSON import nine-rules regression ===\n');
  const results = [];
  const check = (id, title, ok, detail = '') => {
    results.push({ id, title, ok: !!ok, detail });
    console.log(`  ${ok ? '✓' : '✗'} ${id} ${title}${detail ? ` — ${detail}` : ''}`);
  };

  let systemId = null;
  try {
    const sys = await systemDao.create({
      type: NODE_TYPE.SYSTEM,
      parentId: 0,
      name: `TMP-nine-rules-${Date.now()}`,
      url: 'http://example.invalid/nine-rules',
    });
    systemId = Number(sys.id);

    // ── Round 1 baseline ──
    // 评级管理: 对私客户管理(MOVE) + 将删除(DEL) + 将保留(KEEP)
    // 将消失模块 GONE: 空功能稍后只测模块下线/删除
    // 客户管理: 占位「待收编」由手工节点扮演，JSON 本轮不放 ADOPT
    const r1 = await importMenuJson(systemId, jsonBuf([
      top('评级管理', ECD.MOD_RATE, [
        leaf('对私客户管理', ECD.FN_MOVE, ECD.PAGE_MOVE),
        leaf('交易原挂载', ECD.FN_TX_OLD, ECD.PAGE_TX),
        leaf('将删除功能', ECD.FN_DEL, ECD.PAGE_DEL),
        leaf('将保留功能', ECD.FN_KEEP, ECD.PAGE_KEEP),
      ]),
      top('将消失模块', ECD.MOD_GONE, []),
    ]));

    check('R1a', '快照 version=1', r1.snapshotVersion === 1, `v=${r1.snapshotVersion}`);
    const snap1 = await systemMenuSnapshotDao.getLatestVersion(systemId);
    check('R1b', '快照表 latest=1', snap1 === 1, `latest=${snap1}`);

    let { all, mods, fns } = await listUnderSystem(systemId);
    const fnMove1 = byEcd(all, ECD.FN_MOVE);
    const fnTxOld1 = byEcd(all, ECD.FN_TX_OLD);
    const fnDel1 = byEcd(all, ECD.FN_DEL);
    const fnKeep1 = byEcd(all, ECD.FN_KEEP);
    const modRate1 = byEcd(all, ECD.MOD_RATE);
    const modGone1 = byEcd(all, ECD.MOD_GONE);
    assert.ok(fnMove1 && fnTxOld1 && fnDel1 && fnKeep1 && modRate1 && modGone1, 'round1 nodes exist');

    // 手工同名节点（客户管理下「个人客户管理」）供 R6 收编；客户管理模块也手工建
    const modCstManual = await systemDao.create({
      type: NODE_TYPE.MODULE,
      parentId: systemId,
      name: '客户管理',
      source: 'manual',
      umlEcd: '',
      sortOrder: 99,
    });
    const fnAdoptManual = await systemDao.create({
      type: NODE_TYPE.FUNCTION,
      parentId: modCstManual.id,
      name: '个人客户管理',
      source: 'manual',
      umlEcd: '',
      pdCmptEcd: '',
      sortOrder: 1,
    });

    // 交易：KEEP 挂将保留；TX 挂旧功能（round2 同 pageId 换到新功能节点）
    const trajKeepId = await insertTraj({
      name: 'r9-keep',
      functionId: fnKeep1.id,
      pageId: ECD.PAGE_KEEP,
    });
    const trajTxId = await insertTraj({
      name: 'r9-tx-follow',
      functionId: fnTxOld1.id,
      pageId: ECD.PAGE_TX,
    });

    // ── Round 2：综合九条 ──
    // - 评级管理仍在，但不再挂 MOVE/DEL/KEEP
    // - 客户管理（JSON 带 UML_R9_CST）：个人客户管理 = 原 MOVE 改名换父（同 umlEcd）
    //                 + 收编手工「个人客户管理」？ wait - 同名冲突
    //
    // Careful: R4 rename+R2 move uses FN_MOVE umlEcd with new name 个人客户管理 under 客户管理.
    // R6 adopt needs a *different* name under same parent, OR adopt happens when JSON brings
    // umlEcd onto existing same-name node WITHOUT prior umlEcd hit.
    //
    // If we put leaf('个人客户管理', FN_MOVE) under 客户管理, upsert hits byUmlEcd first (FN_MOVE),
    // migrates — never adopts the manual node. Manual「个人客户管理」would remain as duplicate name.
    //
    // Fix layout:
    //  - MOVE rename to 个人客户管理 under JSON 客户管理 (umlEcd FN_MOVE) — creates/uses MOD_CST
    //  - Separate adopt: put leaf('收编目标', FN_ADOPT) under 客户管理, and create manual
    //    sibling named 收编目标 under same JSON module after module exists...
    //
    // Better order for R6:
    //  After r1, create manual fn「收编目标」under 评级管理 (same parent as will appear in JSON).
    //  Round2: under 评级管理 add leaf('收编目标', FN_ADOPT, PAGE_ADOPT) → adopt path.

    // Recreate adopt fixture under 评级管理 (manual, empty umlEcd)
    const fnAdoptUnderRate = await systemDao.create({
      type: NODE_TYPE.FUNCTION,
      parentId: modRate1.id,
      name: '收编目标',
      source: 'manual',
      umlEcd: '',
      sortOrder: 50,
    });
    // Remove the confusing customer-management manual adopt twin (keep module for move target name clash?)
    // Actually JSON will create/update 客户管理 by umlEcd MOD_CST — manual 客户管理 has empty umlEcd.
    // Same name different umlEcd → two modules named 客户管理! Bad.
    // Delete manual 客户管理 + its child before round2; MOVE target module comes from JSON only.
    await getDB()('system').where({ id: fnAdoptManual.id }).del();
    await getDB()('system').where({ id: modCstManual.id }).del();

    const r2 = await importMenuJson(systemId, jsonBuf([
      top('评级管理', ECD.MOD_RATE, [
        leaf('收编目标', ECD.FN_ADOPT, ECD.PAGE_ADOPT),
      ]),
      top('客户管理', ECD.MOD_CST, [
        leaf('个人客户管理', ECD.FN_MOVE, ECD.PAGE_MOVE),
        leaf('交易新挂载', ECD.FN_TX_NEW, ECD.PAGE_TX),
        leaf('全新功能', ECD.FN_NEW, ECD.PAGE_NEW),
      ]),
      // FN_TX_OLD / FN_DEL / FN_KEEP / MOD_GONE absent → offline (+ delete or keep)
    ]));

    check('R1c', '快照 version 递增到 2', r2.snapshotVersion === 2, `v=${r2.snapshotVersion}`);

    ({ all, mods, fns } = await listUnderSystem(systemId));
    const fnMove2 = byEcd(all, ECD.FN_MOVE);
    const modCst2 = byEcd(all, ECD.MOD_CST);
    const modRate2 = byEcd(all, ECD.MOD_RATE);
    const fnNew2 = byEcd(all, ECD.FN_NEW);
    const fnAdopt2 = byEcd(all, ECD.FN_ADOPT);
    const fnDel2 = byEcd(all, ECD.FN_DEL);
    const fnKeep2 = byEcd(all, ECD.FN_KEEP);
    const modGone2 = byEcd(all, ECD.MOD_GONE);

    // R2+R4 move+rename
    check(
      'R2',
      '5.3 子菜单迁移到客户管理',
      fnMove2 && modCst2 && Number(fnMove2.parentId) === Number(modCst2.id) && r2.migratedNodes >= 1,
      `parent=${fnMove2?.parentId} cst=${modCst2?.id} migrated=${r2.migratedNodes}`,
    );
    check(
      'R4',
      '5.5 同 umlEcd 改名 对私→个人',
      fnMove2 && fnMove2.name === '个人客户管理' && Number(fnMove2.id) === Number(fnMove1.id),
      `name=${fnMove2?.name} id=${fnMove2?.id}`,
    );

    // R3 transaction follow (page hops to a different function node)
    const fnTxNew2 = byEcd(all, ECD.FN_TX_NEW);
    const trajTx = await getDB()('trajectory').where({ id: trajTxId }).first();
    check(
      'R3',
      '5.4 交易跟随 pageId 到新功能节点',
      fnTxNew2
        && trajTx
        && Number(trajTx.function_id) === Number(fnTxNew2.id)
        && Number(trajTx.function_id) !== Number(fnTxOld1.id)
        && r2.migratedTransactions >= 1,
      `from=${fnTxOld1.id} to=${trajTx?.function_id} migratedTx=${r2.migratedTransactions}`,
    );

    // R5 create
    check('R5', '新增全新功能', !!fnNew2 && r2.created >= 1, `id=${fnNew2?.id} created=${r2.created}`);

    // R6 adopt
    check(
      'R6',
      '5.7 同名收编 manual→json_import',
      fnAdopt2
        && Number(fnAdopt2.id) === Number(fnAdoptUnderRate.id)
        && fnAdopt2.source === 'json_import'
        && String(fnAdopt2.umlEcd) === ECD.FN_ADOPT
        && r2.adopted >= 1,
      `id=${fnAdopt2?.id} source=${fnAdopt2?.source} adopted=${r2.adopted}`,
    );

    // R7 delete vanished without traj
    check('R7', '5.8 无交易消失功能已删除', !fnDel2 && r2.deleted >= 1, `deleted=${r2.deleted}`);

    // R8 keep vanished with traj
    const trajKeep = await getDB()('trajectory').where({ id: trajKeepId }).first();
    check(
      'R8',
      '5.8 有交易消失功能保留且仍挂交易',
      fnKeep2
        && Number(fnKeep2.removedFlag) === 1
        && trajKeep
        && Number(trajKeep.function_id) === Number(fnKeep2.id),
      `removed=${fnKeep2?.removedFlag} trajFn=${trajKeep?.function_id}`,
    );

    // R9 offline mark (keep fn + gone module)
    check(
      'R9',
      '5.9 下线标记（保留功能 removedFlag=1；空消失模块已删或 offline）',
      Number(fnKeep2?.removedFlag) === 1
        && r2.markedOffline >= 1
        && (!modGone2 || Number(modGone2.removedFlag) === 1),
      `markedOffline=${r2.markedOffline} gone=${modGone2 ? `flag=${modGone2.removedFlag}` : 'deleted'}`,
    );

    // Change log spot checks
    const logs = await menuChangeLogDao.listBySystem(systemId, { limit: 200 });
    const types = new Set(logs.map((e) => e.changeType));
    check('LOG', '变更事件含 moved/renamed/adopted/created/deleted/offline_marked/transaction_migrated',
      ['moved', 'renamed', 'adopted', 'created', 'deleted', 'offline_marked', 'transaction_migrated']
        .every((t) => types.has(t)),
      [...types].join(','));

    // Push payload alignment
    const system = await systemDao.getById(systemId);
    const { nodes } = await listUnderSystem(systemId);
    const menuVersion = await systemMenuSnapshotDao.getLatestVersion(systemId);
    const payload = buildMenuPushPayload(system, nodes, {
      menuVersion,
      partnerSystemId: 51,
      partnerSystemName: '系统1',
    });
    const wire = toPartnerMenuPushPayload(payload);
    const pushMove = wire.menus.find((m) => m.umlEcd === ECD.FN_MOVE);
    const pushKeep = wire.menus.find((m) => m.umlEcd === ECD.FN_KEEP);
    const pushDel = wire.menus.find((m) => m.umlEcd === ECD.FN_DEL);
    const pushNew = wire.menus.find((m) => m.umlEcd === ECD.FN_NEW);

    check('PUSH-V', '推送 menuVersion=最新快照', wire.menuVersion === 2, `wire=${wire.menuVersion}`);
    check(
      'PUSH-MOVE',
      '推送中迁后功能 parentUmlEcd=客户管理且 pageId 仍在',
      pushMove
        && pushMove.name === '个人客户管理'
        && pushMove.parentUmlEcd === ECD.MOD_CST
        && pushMove.pageId === ECD.PAGE_MOVE
        && pushMove.removed === false,
      JSON.stringify(pushMove && { name: pushMove.name, parentUmlEcd: pushMove.parentUmlEcd, pageId: pushMove.pageId, removed: pushMove.removed }),
    );
    check(
      'PUSH-KEEP',
      '推送中有交易保留节点 removed=true 且仍在 menus',
      pushKeep && pushKeep.removed === true && pushKeep.pageId === ECD.PAGE_KEEP,
      JSON.stringify(pushKeep && { removed: pushKeep.removed, pageId: pushKeep.pageId }),
    );
    check('PUSH-DEL', '推送中无已删功能', !pushDel);
    check('PUSH-NEW', '推送含新增功能', !!pushNew);

    // Traj ownership summary
    check(
      'OWN',
      '交易归属：page 迁移→新功能；keep→旧功能',
      Number(trajTx.function_id) === Number(fnTxNew2.id)
        && Number(trajKeep.function_id) === Number(fnKeep2.id),
      `txFn=${trajTx.function_id} keepFn=${trajKeep.function_id}`,
    );
  } catch (err) {
    console.error('\nFATAL:', err.stack || err.message || err);
    results.push({ id: 'FATAL', title: err.message || String(err), ok: false });
  } finally {
    if (systemId) {
      try {
        await cleanupSystem(systemId);
        console.log(`\n  (cleaned system #${systemId})`);
      } catch (e) {
        console.warn('cleanup failed:', e.message || e);
      }
    }
    await getDB().destroy().catch(() => {});
  }

  const failed = results.filter((r) => !r.ok);
  console.log(failed.length ? `\nFAIL ${failed.length}/${results.length}` : `\nOK ${results.length}/${results.length}`);
  process.exitCode = failed.length ? 1 : 0;
}

main();
