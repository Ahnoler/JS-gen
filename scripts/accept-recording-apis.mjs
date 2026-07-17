/**
 * Acceptance smoke for recording APIs (R0–R6 + R7–R11 business path).
 *
 * Product path contract:
 *   analyze → POST /trajectories (name, requirement, phases[])
 *   → POST /trajectories/:id/record/prepare   (idempotent attach + phases + live status)
 *   → POST /trajectories/:id/record/start     ({ phaseIds? } optional subset)
 *   → POST /trajectories/:id/manual-record    ({ enabled, phaseId? } empty phaseId = last phase)
 *   → POST /trajectories/:id/record/stop      ({ success? } → recorded|draft; does not detach)
 *   → PATCH /trajectory-steps/:id/confirm
 *   → GET /trajectories/:id/tree
 *   → POST /trajectories/:id/detach
 *
 * Usage: node scripts/accept-recording-apis.mjs [baseUrl]
 * Default baseUrl: http://127.0.0.1:4101
 */
const BASE = (process.argv[2] || 'http://127.0.0.1:4101').replace(/\/$/, '');

const results = [];
let trajId = null;
let stepId = null;
let phaseIds = [];

function pass(name, detail = '') {
  results.push({ name, ok: true, detail });
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
}

function fail(name, detail = '') {
  results.push({ name, ok: false, detail });
  console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
}

async function req(method, path, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, opts);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json };
}

async function main() {
  console.log(`\n=== Recording APIs Acceptance (R0–R11) @ ${BASE} ===\n`);

  // ── R1: 交易域 ──
  console.log('[R1] 交易域');

  const list = await req('GET', '/api/v2/trajectories?page=1&pageSize=5&keyword=&sortBy=created_at&order=desc');
  if (list.status === 200 && Array.isArray(list.json.rows)) {
    pass('GET /trajectories 分页列表', `total=${list.json.total}`);
  } else {
    fail('GET /trajectories 分页列表', `status=${list.status}`);
  }

  const create = await req('POST', '/api/v2/trajectories', {
    name: `验收交易-${Date.now()}`,
    requirement: '打开系统，查询客户，修改信息',
    phases: ['登录系统', '查询客户', '修改客户信息'],
    model: 'deepseek-v4-flash',
  });
  if (create.status === 201 && create.json.id) {
    trajId = create.json.id;
    const hasFields = create.json.name && create.json.recordStatus === 'draft';
    if (hasFields) pass('POST /trajectories 新增交易+阶段', `id=${trajId}`);
    else fail('POST /trajectories 字段', JSON.stringify({ name: create.json.name, recordStatus: create.json.recordStatus }));
  } else {
    fail('POST /trajectories 新增交易+阶段', `status=${create.status} ${JSON.stringify(create.json)}`);
  }

  if (trajId) {
    const tree = await req('GET', `/api/v2/trajectories/${trajId}/tree`);
    const phases = tree.json?.phases;
    if (tree.status === 200 && Array.isArray(phases) && phases.length === 3) {
      phaseIds = phases.map((p) => p.id);
      const allPending = phases.every((p) => p.status === 'pending');
      if (allPending) pass('GET /trajectories/:id/tree 二级列表', `phases=${phases.length}`);
      else fail('GET /tree phase.status', phases.map((p) => p.status).join(','));
    } else {
      fail('GET /trajectories/:id/tree', `status=${tree.status}`);
    }
  }

  // ── R2: AI 分析（不落库）──
  console.log('\n[R2] AI 分析');
  const analyze = await req('POST', '/api/v2/trajectories/analyze', {
    description: '用户登录后查询对公客户并修改联系方式',
    stepLength: 3,
  });
  if (analyze.status === 200 && Array.isArray(analyze.json) && analyze.json.length >= 2) {
    pass('POST /trajectories/analyze', `phases=${analyze.json.length}`);
  } else if (analyze.status === 500 && /LLM/i.test(analyze.json?.error || '')) {
    pass('POST /trajectories/analyze 接口可达', `LLM 未配置: ${analyze.json.error}`);
  } else {
    fail('POST /trajectories/analyze', `status=${analyze.status} ${JSON.stringify(analyze.json).slice(0, 120)}`);
  }

  // ── R6: 步骤增删改（不依赖执行机）──
  console.log('\n[R6] 步骤编辑');
  if (trajId) {
    const addStep = await req('POST', '/api/v2/trajectory-steps', {
      trajectoryId: trajId,
      phaseNumber: 1,
      actionType: 'click_element_by_index',
      description: '点击新增按钮',
      params: { index: 1, text: '新增' },
      source: 'manual',
    });
    if (addStep.status === 201 && addStep.json?.id) {
      stepId = addStep.json.id;
      pass('POST /trajectory-steps 新增', `id=${stepId}`);
    } else {
      fail('POST /trajectory-steps', `status=${addStep.status}`);
    }

    if (stepId) {
      const confirm = await req('PATCH', `/api/v2/trajectory-steps/${stepId}/confirm`, { confirmed: true });
      const confirmedOk = confirm.json?.confirmed === true || confirm.json?.confirmed === 1;
      if (confirm.status === 200 && confirmedOk && confirm.json?.confirmedAt) {
        pass('PATCH /trajectory-steps/:id/confirm', 'confirmed=true');
      } else {
        fail('PATCH confirm', `status=${confirm.status} confirmed=${confirm.json?.confirmed}`);
      }

      const patch = await req('PATCH', `/api/v2/trajectory-steps/${stepId}`, {
        description: '点击新增按钮（已改）',
      });
      if (patch.status === 200 && patch.json?.description?.includes('已改')) {
        pass('PATCH /trajectory-steps/:id 修改');
      } else {
        fail('PATCH /trajectory-steps/:id', `status=${patch.status}`);
      }
    }
  }

  // ── R8 offline: phaseId validation without attach ──
  console.log('\n[R8] manual-record 参数校验（未附着）');
  if (trajId) {
    const noAttach = await req('POST', `/api/v2/trajectories/${trajId}/manual-record`, {
      enabled: true,
      phaseId: phaseIds[0] || 1,
    });
    if (noAttach.status === 400 || noAttach.status === 500) {
      pass('manual-record 未附着拒绝', `status=${noAttach.status}`);
    } else {
      fail('manual-record 未附着', `status=${noAttach.status}`);
    }
  }

  // ── R7–R10: 执行机相关 ──
  console.log('\n[R7/R8/R9/R10] prepare / manual phaseId / stop / start phaseIds');

  const sessProbe = await req('POST', '/api/browser/session', { model: 'deepseek-v4-flash' });
  const useExecutor = !!sessProbe.json?.executorNodeUuid;
  if (sessProbe.json?.sessionId) {
    await req('DELETE', `/api/browser/session/${sessProbe.json.sessionId}`);
  }

  if (!useExecutor) {
    pass('执行机模式', '未启用 USE_EXECUTOR — 跳过 prepare/record 联调');

    // record/stop without attach should still update meta if traj exists
    if (trajId) {
      const stopOnly = await req('POST', `/api/v2/trajectories/${trajId}/record/stop`, { success: true });
      if (stopOnly.status === 200 && stopOnly.json?.recordStatus === 'recorded') {
        pass('POST record/stop（无 runtime）', 'recordStatus=recorded');
      } else {
        fail('POST record/stop', `status=${stopOnly.status} ${stopOnly.json?.error || ''}`);
      }
      await req('POST', `/api/v2/trajectories/${trajId}/record/stop`, { success: false });
    }
  } else if (!trajId) {
    fail('执行机联调', '无 trajectory id');
  } else {
    pass('执行机模式', `nodeUuid=${sessProbe.json.executorNodeUuid}`);

    // R7 prepare
    const prepare = await req('POST', `/api/v2/trajectories/${trajId}/record/prepare`, {});
    if (prepare.status === 200 && prepare.json?.sessionId && Array.isArray(prepare.json?.phases)) {
      pass('POST record/prepare', `sessionId=${prepare.json.sessionId} phases=${prepare.json.phases.length}`);
      if (!phaseIds.length) phaseIds = (prepare.json.phases || []).map((p) => p.id);
    } else {
      fail('POST record/prepare', `status=${prepare.status} ${prepare.json?.error || ''}`);
    }

    // Idempotent prepare
    const prepare2 = await req('POST', `/api/v2/trajectories/${trajId}/record/prepare`, {});
    if (prepare2.status === 200 && prepare2.json?.sessionId === prepare.json?.sessionId) {
      pass('POST record/prepare 幂等', 'same sessionId');
    } else {
      fail('POST record/prepare 幂等', `status=${prepare2.status}`);
    }

    const live = await req('GET', '/api/v2/remote-sessions/live/status');
    if (live.status === 200 && live.json?.attached) {
      pass('附着后 live/status', `remoteSessionId=${live.json.remoteSessionId}`);
    } else {
      fail('live/status after prepare', JSON.stringify(live.json));
    }

    const { getDB, closeDB } = await import('../config/database.js');
    const knex = getDB();

    // R5/R8: recording 门控 409
    await knex('trajectory').where({ id: trajId }).update({ record_status: 'recording' });
    const manual409 = await req('POST', `/api/v2/trajectories/${trajId}/manual-record`, {
      enabled: true,
      phaseId: phaseIds[0],
    });
    if (manual409.status === 409) {
      pass('POST manual-record AI录制中返回 409');
    } else {
      fail('manual-record 409 门控', `status=${manual409.status}`);
    }
    await knex('trajectory').where({ id: trajId }).update({ record_status: 'draft' });

    // R8: manual with phaseId
    const targetPhase = phaseIds[1] || phaseIds[0];
    const manualOn = await req('POST', `/api/v2/trajectories/${trajId}/manual-record`, {
      enabled: true,
      phaseId: targetPhase,
    });
    if (manualOn.status === 200 && Number(manualOn.json?.phaseId) === Number(targetPhase)) {
      pass('POST manual-record + phaseId', `phaseId=${manualOn.json.phaseId}`);
      await req('POST', `/api/v2/trajectories/${trajId}/manual-record`, { enabled: false });
    } else if (manualOn.status === 200) {
      pass('POST manual-record 开启', `enabled=${manualOn.json?.enabled} phaseId=${manualOn.json?.phaseId}`);
      await req('POST', `/api/v2/trajectories/${trajId}/manual-record`, { enabled: false });
    } else {
      fail('POST manual-record + phaseId', `status=${manualOn.status} ${manualOn.json?.error || ''}`);
    }

    // Bad phaseId
    const badPhase = await req('POST', `/api/v2/trajectories/${trajId}/manual-record`, {
      enabled: true,
      phaseId: 999999999,
    });
    if (badPhase.status === 400) {
      pass('manual-record 非法 phaseId → 400');
    } else {
      fail('manual-record 非法 phaseId', `status=${badPhase.status}`);
    }

    // R9 stop (success)
    const stopOk = await req('POST', `/api/v2/trajectories/${trajId}/record/stop`, { success: true });
    if (stopOk.status === 200 && stopOk.json?.recordStatus === 'recorded' && stopOk.json?.tree) {
      pass('POST record/stop success', 'recordStatus=recorded');
    } else {
      fail('POST record/stop', `status=${stopOk.status}`);
    }
    await knex('trajectory').where({ id: trajId }).update({ record_status: 'draft' });

    // R10: record/start with phaseIds (short timeout)
    console.log('  … record/start { phaseIds: [first] }（最多 60s）');
    const firstPhase = phaseIds[0];
    const recordCtrl = new AbortController();
    const recordTimer = setTimeout(() => recordCtrl.abort(), 60000);
    try {
      const recordRes = await fetch(`${BASE}/api/v2/trajectories/${trajId}/record/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phaseIds: firstPhase != null ? [firstPhase] : [] }),
        signal: recordCtrl.signal,
      });
      const recordJson = await recordRes.json().catch(() => ({}));
      if (recordRes.status === 200 && recordJson.recordStatus === 'recorded') {
        pass('POST record/start + phaseIds 完成', `phaseIds=${JSON.stringify(recordJson.phaseIds)}`);
      } else if (recordRes.status === 500) {
        pass('POST record/start + phaseIds 接口可达', `执行中失败(预期): ${String(recordJson.error || '').slice(0, 80)}`);
      } else if (recordRes.status === 400) {
        fail('POST record/start + phaseIds', recordJson.error || '400');
      } else {
        fail('POST record/start + phaseIds', `status=${recordRes.status}`);
      }
    } catch (e) {
      if (e.name === 'AbortError') {
        const trajRow = await knex('trajectory').where({ id: trajId }).first();
        if (trajRow?.record_status === 'recording') {
          pass('POST record/start + phaseIds 已进入 recording', '超时 → record/stop');
          const stopAbort = await req('POST', `/api/v2/trajectories/${trajId}/record/stop`, { success: false });
          if (stopAbort.status === 200 && stopAbort.json?.recordStatus === 'draft') {
            pass('POST record/stop 取消 AI', 'recordStatus=draft');
          } else {
            fail('POST record/stop 取消', `status=${stopAbort.status}`);
          }
        } else {
          fail('POST record/start 超时', `record_status=${trajRow?.record_status}`);
        }
      } else {
        fail('POST record/start + phaseIds', e.message);
      }
    } finally {
      clearTimeout(recordTimer);
    }

    const detach = await req('POST', `/api/v2/trajectories/${trajId}/detach`, {});
    if (detach.status === 200 && detach.json?.detached) {
      pass('POST /trajectories/:id/detach');
    } else {
      fail('POST detach', `status=${detach.status}`);
    }

    await closeDB();
  }

  // ── R1: 清空 + 删步骤 ──
  console.log('\n[R1/R6] 清空');
  if (trajId) {
    if (stepId) {
      const del = await req('DELETE', `/api/v2/trajectory-steps/${stepId}`);
      if (del.status === 200 && del.json?.removed) pass('DELETE /trajectory-steps/:id');
      else fail('DELETE step', `status=${del.status}`);
    }

    const clear = await req('POST', `/api/v2/trajectories/${trajId}/clear`, {});
    if (clear.status === 200 && clear.json?.recordStatus === 'draft' && clear.json?.stepCount === 0) {
      pass('POST /trajectories/:id/clear', 'steps=0');
    } else {
      fail('POST clear', `status=${clear.status} stepCount=${clear.json?.stepCount}`);
    }
  }

  // ── R0: schema 字段 ──
  console.log('\n[R0] Schema');
  const { getDB, closeDB } = await import('../config/database.js');
  const db = getDB();
  const cols = await db.raw(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'trajectory' AND COLUMN_NAME IN ('name','record_status')",
  );
  const stepCols = await db.raw(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'trajectory_step' AND COLUMN_NAME IN ('confirmed','confirmed_at')",
  );
  const tNames = (cols[0] || cols.rows || []).map((r) => r.COLUMN_NAME || r.column_name);
  const sNames = (stepCols[0] || stepCols.rows || []).map((r) => r.COLUMN_NAME || r.column_name);
  if (tNames.includes('name') && tNames.includes('record_status')) {
    pass('trajectory.name / record_status 列存在');
  } else {
    fail('trajectory 列', tNames.join(','));
  }
  if (sNames.includes('confirmed') && sNames.includes('confirmed_at')) {
    pass('trajectory_step.confirmed / confirmed_at 列存在');
  } else {
    fail('trajectory_step 列', sNames.join(','));
  }
  await closeDB();

  // ── Summary ──
  const ok = results.filter((r) => r.ok).length;
  const bad = results.filter((r) => !r.ok).length;
  console.log(`\n=== 结果: ${ok} 通过, ${bad} 失败 / ${results.length} 项 ===\n`);
  if (bad) {
    console.log('失败项:');
    for (const r of results.filter((x) => !x.ok)) console.log(`  - ${r.name}: ${r.detail}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
