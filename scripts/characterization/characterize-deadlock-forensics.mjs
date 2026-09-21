/**
 * Characterization pin — deadlock 复发自动取证（录制步持久化 retry 兜底旁路）。
 * 不连真 DB、不联网、秒级：DB 访问层通过 captureDeadlockForensics 的可选 opts.db
 * 注入桩（模块引入方式为 #config/database.js 的 getDB，见 deadlock-forensics.js），
 * 接线用 read_text 源码子串断言（同 characterize-stop-semantics 写法）。
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { captureDeadlockForensics } from '../../src/services/trajectory/deadlock-forensics.js';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', '..');
let failures = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✓ ${msg}`); } else { failures += 1; console.error(`  ✗ ${msg}`); }
}

/**
 * 假 DB 桩：raw() 返回 knex Raw 形状的链式对象（.timeout(ms) → Promise），计数可观测。
 * @param {Array|Error} resultOrError raw().timeout() 的 resolve 值（如 [[row], fields]）或 reject 原因
 * @returns {{ state: { rawCalls: number, timeoutArg: number|null }, raw: () => { timeout: (ms: number) => Promise } }} 可注入 opts.db 的桩
 */
function makeFakeDb(resultOrError) {
  const state = { rawCalls: 0, timeoutArg: null };
  return {
    state,
    raw() {
      state.rawCalls += 1;
      return {
        timeout(ms) {
          state.timeoutArg = ms;
          return resultOrError instanceof Error ? Promise.reject(resultOrError) : Promise.resolve(resultOrError);
        },
      };
    },
  };
}

/**
 * 同步抛错版 DB 桩（raw() 直接 throw，模拟连接池损坏）。
 * @returns {{ state: { rawCalls: number }, raw: () => never }} 可注入 opts.db 的桩
 */
function makeThrowingDb() {
  const state = { rawCalls: 0 };
  return {
    state,
    raw() {
      state.rawCalls += 1;
      throw new Error('pool destroyed');
    },
  };
}

/**
 * 捕获 console.error 输出（仅 fn 执行期间替换，finally 还原）。
 * @param {() => (void|Promise<void>)} fn 待执行的异步断言体
 * @returns {Promise<string[]>} fn 执行期间 console.error 收到的行（join(' ') 后逐条）
 */
async function captureConsoleError(fn) {
  const lines = [];
  const orig = console.error;
  console.error = (...args) => lines.push(args.map(String).join(' '));
  try {
    await fn();
  } finally {
    console.error = orig;
  }
  return lines;
}

const deadlockErr = Object.assign(new Error('Deadlock found when trying to get lock'), {
  code: 'ER_LOCK_DEADLOCK',
  errno: 1213,
});

// ── 1. 功能：deadlock 错误 → 取证输出 LATEST DETECTED DEADLOCK 段（截取正确） ──
{
  const fakeStatus = [
    '=======================================',
    'INNODB MONITOR OUTPUT',
    '=======================================',
    'TRX-PREAMBLE-MARKER background thread',
    '------------',
    'LATEST DETECTED DEADLOCK',
    '------------------------',
    '2026-09-21 10:00:00 0x7f8a1c0',
    '*** (1) TRANSACTION:',
    'TRANSACTION 4217, ACTIVE 0 sec inserting',
    'mysql tables in use 1, locked 1',
    '*** (2) TRANSACTION:',
    'TRANSACTION 4218, ACTIVE 0 sec updating',
    '*** WE ROLL BACK TRANSACTION (2)',
    '',
    '------------',
    'TRANSACTIONS',
    '------------',
    'Trx id counter TRX-TAIL-MARKER 4242',
  ].join('\n');
  const fakeDb = makeFakeDb([[{ Type: '', Name: '', Status: fakeStatus }], []]);
  const lines = await captureConsoleError(() => captureDeadlockForensics(
    deadlockErr,
    { trajectoryDbId: 865, actionId: 'a1' },
    { db: fakeDb },
  ));
  const out = lines.join('\n');
  check(fakeDb.state.rawCalls === 1, 'deadlock error triggers exactly one SHOW ENGINE INNODB STATUS');
  check(fakeDb.state.timeoutArg === 3000, 'status query carries .timeout(3000)');
  check(lines.length === 1 && out.includes('[record] deadlock forensics'), 'single console.error line prefixed [record] deadlock forensics');
  check(out.includes('trajectoryDbId=865') && out.includes('actionId=a1'), 'context ids echoed in forensics line');
  check(out.includes('LATEST DETECTED DEADLOCK') && out.includes('*** (1) TRANSACTION:'), 'deadlock section body present in output');
  check(!out.includes('TRX-PREAMBLE-MARKER') && !out.includes('TRX-TAIL-MARKER'), 'section truncated at next ------------ delimiter (no pre/tail leakage)');
}

// ── 2. 过滤：非 deadlock 错误 → 完全不发起查询 ──
{
  const fakeDb = makeFakeDb([[{ Status: 'should never be read' }], []]);
  await captureConsoleError(async () => {
    await captureDeadlockForensics(Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY', errno: 1062 }), {}, { db: fakeDb });
    await captureDeadlockForensics(new Error('plain boom'), {}, { db: fakeDb });
    await captureDeadlockForensics(null, {}, { db: fakeDb });
    await captureDeadlockForensics('ER_LOCK_DEADLOCK', {}, { db: fakeDb });
  });
  check(fakeDb.state.rawCalls === 0, 'non-deadlock errors (ER_DUP_ENTRY/plain/string/null) never query');
  // 守卫四形态各自命中
  const hitDb = makeFakeDb([[{ Status: 'no marker here TRX-TAIL-ONLY-MARKER' }], []]);
  await captureConsoleError(async () => {
    await captureDeadlockForensics({ code: 'ER_LOCK_WAIT_TIMEOUT' }, {}, { db: hitDb });
    await captureDeadlockForensics({ errno: 1205 }, {}, { db: hitDb });
    await captureDeadlockForensics({ errno: 1213 }, {}, { db: hitDb });
    await captureDeadlockForensics({ code: 'ER_LOCK_DEADLOCK' }, {}, { db: hitDb });
  });
  check(hitDb.state.rawCalls === 4, 'guard hits for ER_LOCK_DEADLOCK/1213/ER_LOCK_WAIT_TIMEOUT/1205');
}

// ── 3. 自愈：raw 抛错/超时/无 Status → 恒 resolve 不抛 ──
{
  const throwingDb = makeThrowingDb();
  let threw = false;
  try {
    await captureDeadlockForensics(deadlockErr, { trajectoryDbId: 1 }, { db: throwingDb });
  } catch {
    threw = true;
  }
  check(throwingDb.state.rawCalls === 1 && !threw, 'raw() throwing synchronously → resolves silently');

  const rejectingDb = makeFakeDb(new Error('query timeout'));
  threw = false;
  try {
    await captureDeadlockForensics(deadlockErr, { trajectoryDbId: 2 }, { db: rejectingDb });
  } catch {
    threw = true;
  }
  check(rejectingDb.state.rawCalls === 1 && !threw, 'raw() rejecting (timeout path) → resolves silently');

  const noStatusDb = makeFakeDb([[], []]);
  const lines = await captureConsoleError(() => captureDeadlockForensics(deadlockErr, {}, { db: noStatusDb }));
  check(noStatusDb.state.rawCalls === 1 && lines.length === 0, 'result without Status text → queried once, no output');
}

// ── 4. 接线：runner import + first-failure catch 内 fire-and-forget 调用（子串精确） ──
{
  const runnerSrc = readFileSync(join(ROOT, 'src', 'services', 'trajectory', 'trajectory-recording-runner.js'), 'utf8');
  check(runnerSrc.includes("import { captureDeadlockForensics } from './deadlock-forensics.js';"), 'runner imports captureDeadlockForensics');
  check(
    runnerSrc.includes('void captureDeadlockForensics(err1, { trajectoryDbId: tid, actionId: id }).catch(() => {});'),
    'runner calls forensics fire-and-forget in first-failure catch (before retry)',
  );
  const forensicsSrc = readFileSync(join(ROOT, 'src', 'services', 'trajectory', 'deadlock-forensics.js'), 'utf8');
  check(forensicsSrc.includes("from '#config/database.js'") && forensicsSrc.includes('getDB()'), 'forensics uses sibling getDB import style');
  check(forensicsSrc.includes("db.raw('SHOW ENGINE INNODB STATUS').timeout("), 'forensics queries SHOW ENGINE INNODB STATUS with .timeout');
}

if (failures) { console.error(`FAIL: ${failures} assertion(s) failed`); process.exit(1); }
console.log('characterize-deadlock-forensics: OK');
