"""Duplicate-failure steering cue (E3) — pure helpers.

Detects two consecutive steps that reused the exact same action signature and
failed again (result text starting with ``err-``), and builds a ``[纠偏]``
prescription message. Feature flag: AI_DUP_FAILURE_CUE (default off). Cue
injection lives in recorder_emitters._emit_duplicate_failure_cue.
"""

from __future__ import annotations

import json

_LAST_KEY = '_dup_failure_last'
_CUED_KEY = '_dup_failure_cued'

_PREFIX = '[纠偏] '
_GENERIC = (
    _PREFIX + '你已连续 2 次用相同参数执行同一动作且都失败。'
    '禁止原样重试，换参数或换策略。'
)

_ERR_PRESCRIPTIONS = (
    (
        'err-save-button-not-found',
        _PREFIX + '禁止原样重试。从错误信息 candidates 里取 section_title，'
        '调用 click_save(button_text="保存", region="该标题") 重试；'
        '若 candidates 为空，先 close_dialog 关闭干扰弹窗。',
    ),
    (
        'err-save-ambiguous',
        _PREFIX + '禁止不带 region= 重试。取 candidates 中的区域标题，'
        '显式 click_save(..., region="…")。',
    ),
    (
        'err-region-required',
        _PREFIX + '按响应里的 pending_by_region 选择当前阶段对应区域，'
        '带 region= 重试；禁止为清闸门去填无关折叠块。',
    ),
    (
        'err-pending-fields',
        _PREFIX + '先只修错误里列出的 pending 字段（fill/select），'
        '全部写完后再次 click_save()；禁止空手重试保存。',
    ),
    (
        'err-save-validation',
        _PREFIX + '先按错误标签修复字段，再 click_save()；禁止原样重试。',
    ),
    (
        'err-save-notification',
        _PREFIX + '先按错误标签修复字段，再 click_save()；禁止原样重试。',
    ),
    (
        'err-notification',
        _PREFIX + '系统返回了报错。先读清错误文本：修正选择/字段后再重试'
        '（如更换或清除已选人），禁止原样重复点击确认/保存。',
    ),
)


def step_failed(results) -> bool:
    """True when any ActionResult carries an err- result (content or error attr)."""
    items = results if isinstance(results, list) else ([results] if results else [])
    for r in items:
        if r is None:
            continue
        text = str(getattr(r, 'extracted_content', '') or '').strip()
        err = str(getattr(r, 'error', '') or '').strip()
        if text.startswith('err-') or err.startswith('err-'):
            return True
    return False


def result_error_text(results) -> str:
    """First err- text (extracted_content preferred, then error attr) or ''."""
    items = results if isinstance(results, list) else ([results] if results else [])
    for r in items:
        if r is None:
            continue
        text = str(getattr(r, 'extracted_content', '') or '').strip()
        if text.startswith('err-'):
            return text
    for r in items:
        if r is None:
            continue
        err = str(getattr(r, 'error', '') or '').strip()
        if err.startswith('err-'):
            return err
    return ''


def duplicate_failure_prescription(err_text: str) -> str:
    err = (err_text or '').strip()
    for prefix, msg in _ERR_PRESCRIPTIONS:
        if err.startswith(prefix):
            return msg
    return _GENERIC


def _action_signature(actions) -> str:
    if not actions:
        return ''
    return json.dumps([a if isinstance(a, str) else str(a) for a in actions], ensure_ascii=False)


def is_duplicate_failure(store: dict, actions, *, failed: bool) -> tuple[bool, str]:
    """Track consecutive identical failures. Returns (should_cue, signature).

    Cues at most once per phase per signature (store key ``_dup_failure_cued``).
    Any step still refreshes ``_dup_failure_last`` so an ok / different step
    resets the streak.
    """
    sig = _action_signature(actions)
    if not sig:
        return False, ''
    cued = set(store.get(_CUED_KEY) or [])
    if sig in cued:
        store[_LAST_KEY] = {'sig': sig, 'failed': bool(failed)}
        return False, sig
    last = store.get(_LAST_KEY)
    store[_LAST_KEY] = {'sig': sig, 'failed': bool(failed)}
    if not (isinstance(last, dict) and last.get('sig') == sig and last.get('failed') and failed):
        return False, sig
    cued.add(sig)
    store[_CUED_KEY] = cued
    return True, sig
