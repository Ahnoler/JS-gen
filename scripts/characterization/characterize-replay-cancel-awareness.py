"""Pin stop-chain engine fixes E1/E3/E4 (replay-loop cancel awareness).

E1: replay_action_entries checks the per-session cancel flag at EVERY step
boundary BEFORE dispatching that step — an observed cancel aborts the batch
BEFORE the step executes, consumes (clears) the flag, and the return gains
``aborted: True`` + ``stoppedAt`` = the 1-based step number where the cancel
was observed (that step NOT executed; distinct from stop_on_fail's stoppedAt
which halts AFTER the failed step ran).

E3: cancel gates use a CONTENT check (payload == 'cancel'), not exists() —
the compat clear-then-run order writes an EMPTY flag file, so a leftover
empty file must never read as a cancel request.

E4: dead ``agent._tasks`` cancellation loops removed from agent/service.py
(browser_use Agent has no ``_tasks`` attribute — both loops were no-ops).

Offline: fake browser_context + tmp-dir flag files, no browser.
"""
import asyncio
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

FAILURES = []


def check(cond, msg):
    """Record a failure when cond is falsy."""
    if cond:
        print(f"  OK   {msg}")
    else:
        print(f"  FAIL {msg}")
        FAILURES.append(msg)


class _StubPage:
    """Trivial page stub: evaluate returns falsy (no loading state)."""

    def __init__(self):
        self.evaluate_calls = 0

    async def evaluate(self, *args, **kwargs):
        self.evaluate_calls += 1
        return None

    async def wait_for_timeout(self, *_args, **_kwargs):
        return None


class _StubContext:
    """Fake browser_context: async get_current_page() returns a stub page."""

    def __init__(self):
        self.page = _StubPage()
        self.get_current_page_calls = 0

    async def get_current_page(self):
        self.get_current_page_calls += 1
        return self.page


def _entry_unknown(name='no_such_action_xyz'):
    return {'action': name, 'params': {}}


def main() -> int:
    from scripts.state import (
        cancel_flag_path_for,
        clear_cancel_flag,
        is_cancel_requested,
    )
    from scripts.controller.actions._replay import replay_action_entries

    tmp = tempfile.mkdtemp(prefix='cancel-pin-')

    # ===== a) helpers =====
    print("[a] cancel-flag helpers")
    missing = Path(tmp) / 'flag_missing'
    check(is_cancel_requested(missing) is False, 'missing file -> False')
    empty = Path(tmp) / 'flag_empty'
    empty.write_text('', encoding='utf-8')
    check(is_cancel_requested(empty) is False, 'empty file -> False (E3: exists() residue must not cancel)')
    cancel = Path(tmp) / 'flag_cancel'
    cancel.write_text('cancel', encoding='utf-8')
    check(is_cancel_requested(cancel) is True, "content 'cancel' -> True")
    ws = Path(tmp) / 'flag_ws'
    ws.write_text('  cancel\n', encoding='utf-8')
    check(is_cancel_requested(ws) is True, "'cancel' + whitespace -> True")
    keep = Path(tmp) / 'flag_keep'
    keep.write_text('keep', encoding='utf-8')
    check(is_cancel_requested(keep) is False, "content 'keep' -> False")
    check(is_cancel_requested(None) is False, 'None path -> False')
    check(is_cancel_requested(Path(tmp)) is False, 'directory path (read raises) -> False')

    missing2 = Path(tmp) / 'flag_clear_missing'
    try:
        clear_cancel_flag(missing2)
        check(True, 'clear on missing path does not raise')
    except Exception as e:  # pragma: no cover
        check(False, f'clear on missing path raised: {e}')
    check(is_cancel_requested(missing2) is False,
          'after clear on missing path: not cancel')
    cleared = Path(tmp) / 'flag_clear_existing'
    cleared.write_text('cancel', encoding='utf-8')
    clear_cancel_flag(cleared)
    check(cleared.read_text(encoding='utf-8') == '', "existing 'cancel' cleared to empty")
    check(is_cancel_requested(cleared) is False, 'cleared flag is not cancel')

    p = cancel_flag_path_for('sess42')
    check(str(p).endswith('browser_use_cancel_sess42'),
          'cancel_flag_path_for names browser_use_cancel_{sid}')
    check(p.parent == Path(tempfile.gettempdir()), 'cancel_flag_path_for lives in tempdir')

    # ===== b) replay_action_entries loop behavior (fake browser_context) =====
    print("[b] replay_action_entries loop cancel awareness")

    # 1. No flag -> both steps execute, no 'aborted' key.
    ctx1 = _StubContext()
    out1 = asyncio.run(replay_action_entries(
        ctx1,
        [_entry_unknown(), _entry_unknown()],
        controller_actions={},
        business_data_store={},
        cancel_flag_path=None,
    ))
    check(out1.get('count') == 2, 'no-flag: both steps executed (count==2)')
    check(len(out1.get('results') or []) == 2, 'no-flag: both rows in results')
    check('aborted' not in out1, "no-flag: 'aborted' key absent")
    check('stoppedAt' not in out1, 'no-flag: stoppedAt absent')
    check(all(r.get('result') == 'unknown-action:no_such_action_xyz' for r in out1['results']),
          'no-flag: unknown-action path, zero page interaction')
    check(ctx1.get_current_page_calls == 3,
          'no-flag: get_current_page called once pre-loop + once per-step tail (3)')

    # 2. Flag pre-set to 'cancel' -> step 1 NOT executed, batch aborts.
    ctx2 = _StubContext()
    flag2 = Path(tmp) / 'flag_batch'
    flag2.write_text('cancel', encoding='utf-8')
    out2 = asyncio.run(replay_action_entries(
        ctx2,
        [_entry_unknown('no_such_action_a'), _entry_unknown('no_such_action_b')],
        controller_actions={},
        business_data_store={},
        cancel_flag_path=flag2,
    ))
    check(out2.get('results') == [], 'cancel: step 1 NOT executed (results == [])')
    check(out2.get('aborted') is True, "cancel: 'aborted' is True")
    check(out2.get('stoppedAt') == 1, 'cancel: stoppedAt == 1 (1-based step observed)')
    check(out2.get('count') == 0 and out2.get('ok') == 0 and out2.get('failed') == 0,
          'cancel: count/ok/failed reflect zero executed steps')
    check(flag2.exists() and flag2.read_text(encoding='utf-8') == '',
          'cancel: flag consumed (cleared to empty) after return')

    # 3. stop_on_fail interplay untouched: failed step halts AFTER running, no 'aborted'.
    ctx3 = _StubContext()
    out3 = asyncio.run(replay_action_entries(
        ctx3,
        [_entry_unknown('no_such_action_f')],
        controller_actions={},
        business_data_store={},
        stop_on_fail=True,
        cancel_flag_path=None,
    ))
    check(out3.get('stoppedAt') == 1, 'stop_on_fail: stoppedAt set')
    check('aborted' not in out3, "stop_on_fail: 'aborted' key absent")
    check(out3.get('count') == 1 and out3.get('failed') == 1,
          'stop_on_fail: failed step counted (halted after it ran)')

    # ===== c) needle assertions =====
    print("[c] source needles")
    replay_src = (ROOT / 'scripts/controller/actions/_replay.py').read_text(encoding='utf-8')
    idx_for = replay_src.find('for i, entry in enumerate(entries):')
    idx_cancel = replay_src.find('if is_cancel_requested(cancel_flag_path):')
    idx_log = replay_src.find('[replay] [{step_num}/{total}]', idx_cancel)
    check(idx_for != -1 and idx_cancel != -1 and idx_for < idx_cancel,
          '_replay: cancel check present right after loop head')
    # M2 收紧：检查必须落在「步号赋值之后、步日志与动作分发之前」的循环头段——
    # 若被移到步日志之后仍先于分发，旧行为不变但 stderr 顺序误导，此处直接红。
    idx_stepnum = replay_src.find('step_num = i + 1', idx_for)
    idx_dispatch = replay_src.find('extra_row_fields = None', idx_for)
    check(idx_stepnum != -1 and idx_dispatch != -1 and idx_stepnum < idx_cancel < idx_dispatch,
          '_replay: cancel check sits between step_num assignment and action dispatch')
    check(idx_cancel < idx_log,
          '_replay: cancel check precedes the per-step stderr log (first in loop body)')
    seg = replay_src[idx_cancel:idx_log]
    check('aborted = True' in seg, '_replay: aborted set in cancel branch')
    check('clear_cancel_flag(cancel_flag_path)' in seg, '_replay: flag consumed before break')
    check('break' in seg, '_replay: branch breaks the loop')
    check("if aborted:\n            out['aborted'] = True" in replay_src,
          "_replay: return adds 'aborted' conditionally")

    dispatch_src = (ROOT / 'scripts/event_dispatch.py').read_text(encoding='utf-8')
    idx_call = dispatch_src.find('replay_action_entries(')
    idx_clear = dispatch_src.find('clear_cancel_flag(cancel_flag)')
    check(idx_clear != -1 and idx_call != -1 and idx_clear < idx_call,
          'event_dispatch: clear_cancel_flag called BEFORE replay_action_entries call')
    check('cancel_flag_path=cancel_flag' in dispatch_src,
          'event_dispatch: cancel_flag_path passed into replay_action_entries')
    check('summary.get("aborted")' in dispatch_src and 'done_data["aborted"]' in dispatch_src,
          'event_dispatch: aborted reaches the replay_done payload')

    rec_src = (ROOT / 'scripts/recorder.py').read_text(encoding='utf-8')
    check(rec_src.count('is_cancel_requested(cancel_flag_path)') == 2,
          'recorder: BOTH hook gates use is_cancel_requested')
    check('cancel_flag_path.exists()' not in rec_src,
          'recorder: no exists() gate remains (E3)')

    svc_src = (ROOT / 'scripts/agent/service.py').read_text(encoding='utf-8')
    check('for t in getattr(' not in svc_src and "t.cancel()" not in svc_src,
          'service: dead _tasks cancellation loops removed (E4; docstring mention exempted)')
    check(svc_src.count('_tasks') == svc_src.count('``agent._tasks``'),
          'service: _tasks appears only in the removal-history docstring note')
    check('emit_json({"event": "agent_stopped", "data": {"reason": reason}})' in svc_src,
          'service: agent_stopped emission with {"reason": reason} intact')
    check('协作式语义' in svc_src and '已于 2026-09-21 移除' in svc_src,
          'service: cooperative-semantics docstring note present')

    runner_src = (ROOT / 'scripts/session_runner.py').read_text(encoding='utf-8')
    check("Path(cancel_flag_path).write_text('', encoding='utf-8')" in runner_src
          and '新阶段开始：清掉上轮 cancel 残留' in runner_src,
          'session_runner: phase-start clear-then-run order UNCHANGED (compat)')

    # ===== d) verify-all registration self-check =====
    print("[d] verify-all registration")
    va_src = (ROOT / 'scripts/refactor/verify-all.sh').read_text(encoding='utf-8')
    reg = 'characterize-replay-cancel-awareness|"$PY" scripts/characterization/characterize-replay-cancel-awareness.py'
    pe_start = va_src.find("PINS_EXECUTOR='")
    pe_end = va_src.find("PINS_UI='")
    pe = va_src[pe_start:pe_end] if pe_start != -1 and pe_end != -1 else ''
    check(reg in va_src, 'pin registered in verify-all.sh')
    check(reg in pe, 'pin registered inside the PINS_EXECUTOR block')

    if FAILURES:
        print(f"\ncharacterize-replay-cancel-awareness: FAILED ({len(FAILURES)})")
        return 1
    print("\ncharacterize-replay-cancel-awareness: OK")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
