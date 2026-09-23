"""Task-mode classification for phase preambles (extracted from _phase_context).

Regex constants + NL task classification: login / query / open-page / wizard /
modify / fill → TaskMode. ``apply_task_mode`` writes the compat flags into
business_data_store. Feature-flag re-exports kept here for facade parity.
"""

from __future__ import annotations

import re
from typing import Literal

from scripts.feature_flags import (  # noqa: F401 — re-export
    memory_whitelist_enabled,
    phase_preamble_enabled,
)

TaskMode = Literal['login', 'query', 'form_fill', 'form_modify', 'other']

# Task text that requires overwriting every editable field (modify-dialog refill).
_FORCE_REFILL_RE = re.compile(
    r'修改表单中所有字段|修改所有字段|改所有字段|全部字段.*修改|修改.*全部字段'
)

# Query/filter-only phases — no 保存/提交; agent must click 查询, not click_save.
_QUERY_TASK_RE = re.compile(r'查询|搜索|查找')
_RESET_PHASE_RE = re.compile(r'重置|清空|恢复默认')
_QUERY_ACTION_RE = re.compile(r'点击查询|点击搜索|执行查询|执行搜索|查询按钮|搜索按钮')
# 明确的查询动作。后面紧跟汉字时不是（「点击查询事由」是字段，不是点查询按钮）。
_EXPLICIT_QUERY_RE = re.compile(
    r'点击\s*[【\[「『]?\s*(?:查询|搜索)(?![\u4e00-\u9fff])|'
    r'执行(?:查询|搜索)|(?:查询|搜索)\s*按钮'
)
# 点下拉 / 输入框 / 日期控件再选值。遮住的是控件操作，不看字段叫什么。
_WIDGET_OP_RE = re.compile(
    r'(?:点击|选择|填写|在)'
    r'[^，。；\n]{0,30}?'
    r'(?:下拉框|下拉|输入框|日期控件|日期框)'
    r'[^，。；\n]{0,30}'
)
# 2026-09-18 冲突普查 S3：补 维护/更新/变更（_MODIFY_TASK_RE 已有 维护）——
# 「维护客户信息：查询定位后修改」族否则被判 query，且 is_modify_task 被
# is_query_task 先否决（从菜单直进详情的维护不点查询 → done 死循环）。
_QUERY_EXCLUDE_RE = re.compile(
    r'新增|创建|编辑|修改|保存|提交|删除|录入|校验|导入|维护|更新|变更'
)
_QUERY_CONDITION_RE = re.compile(r'(?:查询|筛选)条件')
# 条件路径先于 _QUERY_EXCLUDE_RE 生效，硬排除词表必须对齐其 CRUD 词表——
# 2026-09-18 冲突普查 S1：缺 新增/录入/维护 时「新增后在查询条件中输入…」
# 会经条件路径误判 query，签出流程产不出的 query_clicked 令牌（done 死循环）。
_QUERY_CONDITION_HARD_EXCLUDE_RE = re.compile(
    r'新增|录入|维护|创建|编辑|修改|保存|提交|删除|校验|导入'
)
# Wizard / multi-step pages often say「客户名称搜索为…，点击下一步」— that is NOT
# list-filter query (must not force「点查询 → done」).
_WIZARD_NAV_RE = re.compile(r'下一步|上一步|进入下一步|点击下一步')
# Open-page / navigate phases:「点击评级申请。预期结果：打开评级申请相关页面」—
# done once the target page/dialog appears; do NOT continue the flow inside it.
# 2026-09-21：补「窗口/选择窗/选择框」——客户选择窗口、引入窗口等 picker 打开阶段
# 此前只认页面/弹窗/对话框，导致「打开客户选择窗口」不被识别为开页导航。
_OPEN_PAGE_EXPECT_RE = re.compile(
    r'预期结果[:：]?[^。；\n]{0,12}(?:打开|进入|抵达|到达|弹出)[^。；\n]{0,20}(?:页面|界面|弹窗|对话框|向导页?|窗口|选择窗|选择框)'
)
# Save-to-open phases (点击保存。预期结果：保存成功并进入列表页) keep prompt rule 3
# (click_save → ok-save-navigation → done) — NOT open-page navigation.
_OPEN_PAGE_EXCLUDE_RE = re.compile(r'保存|提交')
# S2b（2026-09-18 冲突普查）：动作子句本身是「打开/进入…页面」的开页导航、
# 页面名恰含查询词（「打开查询中心页面。预期结果：抵达查询中心页面」）——
# 语义是导航开页，不签 query_clicked 合同。限定动作子句匹配（而非全文本）
# 是为放过真查询的「打开查询结果页」预期（cold pin: query + open expectation）。
_OPEN_PAGE_ACTION_RE = re.compile(
    r'(?:打开|进入|抵达|到达|弹出)[^。；\n]{0,20}(?:页面|界面|弹窗|对话框|向导页?|窗口|选择窗|选择框)'
)

# Suffixes appended for AI fill context — must NOT affect task-mode / boundary classify.
_BUSINESS_DATA_MARK_RE = re.compile(
    r'\n*【(?:业务数据|业务场景案例数据|预设案例数据)[^\n]*】[\s\S]*$',
)

# Form modify (edit existing values) — distinct from blank form_fill.
_MODIFY_TASK_RE = re.compile(r'修改|编辑|更新|变更|改填|维护')

# Explicit new/entry form fill — required for form_fill (not a catch-all default).
_FILL_TASK_RE = re.compile(r'新增|创建|录入|填写|新建|添加|校验|开立')

# Pure login phase (navigate to login / enter credentials).
_LOGIN_TASK_RE = re.compile(r'登录|登入|/login|#/login', re.IGNORECASE)
_LOGIN_EXCLUDE_RE = re.compile(
    r'新增|创建|录入|填写|修改|编辑|查询|搜索|删除|保存|提交|校验'
)


def _action_clause(task_text: str) -> str:
    """动作子句 = 任务文本中「预期结果」之前的部分（2026-09-18 冲突普查 S2 轴检查）。

    「点击【更多】按钮。预期结果：查询条件字段展开。」——查询词只出现在预期
    结果子句（名词性观察描述，如「查询条件字段展开」「列表展示匹配客户」），
    动作子句无任何查询语义，不构成 query 任务。无「预期结果」时返回原文，
    行为不变。
    """
    return re.split(r'预期结果[:：]?', task_text, maxsplit=1)[0]


def force_refill_all_required(task_text: str) -> bool:
    """True when the phase task requires overwriting all editable form fields."""
    return bool(_FORCE_REFILL_RE.search(task_text or ''))


def strip_business_data_block(task_text: str) -> str:
    """Remove trailing 【业务数据】/ legacy case-data blocks from phase text.

    Those blocks are fill *values*, not phase goals. Keeping them in classify
    text caused navigate phases to become form_fill (boilerplate contains「填写」)
    or introduce (key data contains「引入」).
    """
    t = str(task_text or '')
    t = _BUSINESS_DATA_MARK_RE.sub('', t)
    return t.strip()


def classification_task_text(task_text: str) -> str:
    """Phase text used for task_mode / boundary / intent — no business-data suffix."""
    return strip_business_data_block(task_text)


# Store keys that carry login credentials — a login phase whose business data
# provides them must receive the 业务数据 hint (auth dry-run rehearsal; without
# it the agent has no credential source and NO-DATA idles out with zero actions).
_AUTH_CREDENTIAL_KEYS = frozenset({
    'username', 'password', '账号', '帐号', '用户名', '密码', '口令',
})


def _store_has_auth_credentials(business_data_store: dict | None) -> bool:
    """True when the store's user business data carries a credential key.

    User KV keys only (skip internal ``_``-prefixed runtime keys).
    """
    if not business_data_store:
        return False
    for key in business_data_store.keys():
        if not isinstance(key, str) or key.startswith('_'):
            continue
        if key.strip().lower() in _AUTH_CREDENTIAL_KEYS:
            return True
    return False


def needs_business_data_context(
    task_text: str,
    business_data_store: dict | None = None,
) -> bool:
    """Whether to show 【业务数据】to the model for this phase.

    Fill / modify / introduce / **query(search)** get the hint — search keywords
    and locate targets live in 关键数据 (#676). Not pure open-page navigate,
    or login without credential keys (auth dry-run opts login in when keys exist).
    """
    t = classification_task_text(task_text)
    if not t:
        return False
    if business_data_store:
        contract = business_data_store.get('_phase_intent') or {}
        mode = contract.get('mode')
        if mode == 'login':
            return _store_has_auth_credentials(business_data_store)
        if mode == 'navigate':
            return False
        if mode == 'query':
            return True
        if mode in ('create', 'modify', 'introduce_pick'):
            return True
        boundary = business_data_store.get('_phase_boundary') or {}
        if boundary.get('role') == 'navigate':
            return False
        if boundary.get('role') in ('maintain', 'introduce', 'query'):
            return True
    mode = classify_task_mode(t)
    if mode in ('form_fill', 'form_modify', 'query'):
        return True
    if business_data_store:
        boundary = business_data_store.get('_phase_boundary') or {}
        if boundary.get('role') == 'introduce' or boundary.get('requires_introduce_then_save'):
            return True
        contract = business_data_store.get('_phase_intent') or {}
        if contract.get('mode') == 'introduce_pick':
            return True
    if mode == 'login':
        # Credential-keyed store opts the login phase in (auth dry-run);
        # plain login phases without credentials stay excluded.
        return _store_has_auth_credentials(business_data_store)
    # Pure open-page / menu navigate — no value hints
    if mode == 'other' and is_open_page_task(t):
        return False
    # Introduce-only goals often classify as other
    if re.search(r'引入|选人|客户选择|选择客户|选择.*客户', t):
        return True
    return False


def is_wizard_nav_task(task_text: str) -> bool:
    """True when the phase advances a wizard (下一步/上一步), not list query."""
    return bool(_WIZARD_NAV_RE.search(classification_task_text(task_text)))


def is_open_page_task(task_text: str) -> bool:
    """True when the expected result is just opening/entering a page or dialog.

    e.g.「选中客户名称…，点击评级申请。预期结果：打开评级申请相关页面。」— the phase
    ends when the target page/dialog shows; the agent must not run the flow inside.
    Save-to-open texts (…点击保存。预期结果：…进入列表页面) are excluded — they keep
    the click_save → ok-save-navigation → done rule.
    """
    t = classification_task_text(task_text)
    if _OPEN_PAGE_EXCLUDE_RE.search(t):
        return False
    return bool(_OPEN_PAGE_EXPECT_RE.search(t))


def mask_widget_ops(task_text: str) -> str:
    """Hide dropdown / input / date-control operations so their labels are not verbs.

    「点击查询类型下拉框选择一个值」里的「查询」是字段名。「按查询类型筛选」
    和「点击查询」没有这层控件结构，文字保持原样。
    """
    return _WIDGET_OP_RE.sub('', task_text or '')


def explicit_query_action(task_text: str) -> bool:
    """True when this phase's action clause clicks or runs 查询/搜索."""
    action = _action_clause(classification_task_text(task_text))
    return bool(_EXPLICIT_QUERY_RE.search(action))


def expected_fill_done(task_text: str) -> bool:
    """True when the expected result is form-field completion, not filter completion."""
    t = classification_task_text(task_text)
    parts = re.split(r'预期结果[:：]?', t, maxsplit=1)
    if len(parts) < 2:
        return False
    expect = parts[1]
    if re.search(r'(?:查询|筛选)条件填写完成', expect):
        return False
    return bool(re.search(r'填写完成', expect))


def explicit_step_action(task_text: str) -> bool:
    """True when this phase's action clause clicks 下一步 or 上一步."""
    action = _action_clause(classification_task_text(task_text))
    return bool(re.search(r'点击\s*[【\[「『]?\s*(?:下一步|上一步)', action))


def is_query_task(task_text: str) -> bool:
    """True when the phase is a search/filter task (no form-save semantics).

    Matches「查询产品信息」etc. Excludes mixed CRUD tasks that also mention 查询
    (e.g. 查询后新增 / 修改并保存) — those still use form-save when a dialog opens.
    Also excludes wizard copy like「客户名称搜索为…，点击下一步」(set field + next).
    Dropdown / input / date-control clauses are masked first, so a field label
    that contains 查询 is not itself a search. Main-page query toolbars are
    additionally detected via DOM (有查询无保存).
    """
    t = mask_widget_ops(classification_task_text(task_text))
    if not _QUERY_TASK_RE.search(t):
        return False
    if _RESET_PHASE_RE.search(t) and not _QUERY_ACTION_RE.search(t):
        # 重置/清空类阶段（如「点击重置，清空所有查询条件字段并恢复默认状态」）
        # 恢复默认态、不产生 query_clicked 证据——按查询合同会签出永不满足的
        # done 门禁（2026-09-17 评级重置阶段 done 死循环）。归 other：无需令牌。
        # 但文本含显式查询动作（点击查询/执行搜索…）的复合阶段不排除：其流程
        # 真会点查询、令牌可产出，落 other/maintain 反而签出新的永不满足合同。
        return False
    if not _QUERY_TASK_RE.search(_action_clause(t)):
        # S2 动作子句轴（2026-09-18 冲突普查）：查询词只出现在预期结果子句的
        # 文本不构成 query——预期结果里的「查询条件字段展开」「列表展示匹配
        # 客户」是名词性观察描述，动作子句才承载任务语义。
        return False
    expect_parts = re.split(r'(预期结果[:：]?)', t, maxsplit=1)
    if len(expect_parts) == 3:
        expect_clause = expect_parts[1] + expect_parts[2]
        if (
            _OPEN_PAGE_EXPECT_RE.search(expect_clause)
            and not _QUERY_ACTION_RE.search(t)
            and _OPEN_PAGE_ACTION_RE.search(_action_clause(t))
        ):
            # S2b 开页型预期排除（2026-09-18 冲突普查）：「打开查询中心页面。
            # 预期结果：抵达查询中心页面」——动作子句是「打开…页面」导航、
            # 页面名恰含查询词，落 open_page/navigate 管辖（url_change/
            # page_opened 令牌可产出），不签永不可满足的 query_clicked 合同。
            # 动作子句须自身为开页导航：真查询的自然预期「打开查询结果页」
            # （cold pin: query + open expectation → query）不得被误排除；
            # 显式查询动作（点击查询/查询按钮）命中的复合阶段同样不排除。
            return False
    if (
        _QUERY_CONDITION_RE.search(t)
        and not _QUERY_CONDITION_HARD_EXCLUDE_RE.search(t)
        and not is_wizard_nav_task(t)
    ):
        return True
    if _QUERY_EXCLUDE_RE.search(t):
        return False
    if is_wizard_nav_task(t):
        return False
    return True


_LOGIN_ACT_RE = re.compile(
    r'点击\s*[【\[「『]?\s*登录|输入.{0,12}(?:账号|帐号|用户名|密码)|'
    r'(?:#|/)\s*login|使用账号登录|登录系统|登入',
    re.IGNORECASE,
)


def is_login_task(task_text: str) -> bool:
    """True when the phase is only sign-in (not login-then-fill in one blob).

    「打开登录页面」是开页，登录动作留给写明输入账号或点击登录的阶段。
    登录二字只出现在预期结果里时，本阶段也不是登录。
    """
    t = classification_task_text(task_text)
    if not t or not _LOGIN_TASK_RE.search(t):
        return False
    if _LOGIN_EXCLUDE_RE.search(t):
        return False
    action = _action_clause(t)
    if not _LOGIN_TASK_RE.search(action):
        return False
    if _OPEN_PAGE_ACTION_RE.search(action) and not _LOGIN_ACT_RE.search(action):
        return False
    return True


def is_modify_task(task_text: str) -> bool:
    """True when the phase is editing an existing form (not blank entry, not query).

    修改/维护必须写在动作子句里。预期结果里的「修改成功」，或上一阶段处于
    修改模式，不把本阶段改判成修改。
    """
    t = classification_task_text(task_text)
    if not t or is_query_task(t) or is_login_task(t):
        return False
    action = _action_clause(t)
    if force_refill_all_required(action):
        return True
    return bool(_MODIFY_TASK_RE.search(action))


def is_fill_task(task_text: str) -> bool:
    """True when the phase is explicit new/entry form filling."""
    t = classification_task_text(task_text)
    if not t or is_query_task(t) or is_login_task(t) or is_modify_task(t):
        return False
    if _QUERY_CONDITION_RE.search(t) and not _QUERY_ACTION_RE.search(t):
        # 查询工具栏填条件、无显式查询动作（2026-09-18 冲突普查回归修复，全量
        # verify-all 抓到）：查询词仅落在预期结果子句时 is_query_task 已被动作
        # 子句轴排除，但「新增/填写」等 fill 词可能只是下拉框取值或预期结果描述
        # （如评级发生类型选择"新增"），落 form_fill 会签出查询工具栏永不产出
        # 的 toast/save 保存合同（maintain 死循环同族）。按四分类矩阵第③类落
        # other 免令牌。
        return False
    return bool(_FILL_TASK_RE.search(t))


def classify_task_mode(task_text: str) -> TaskMode:
    """Classify phase intent. ``form_fill`` only when entry keywords match — never default.

    Classification ignores trailing 【业务数据】blocks (value hints, not goals).
    """
    t = classification_task_text(task_text)
    if is_login_task(t):
        return 'login'
    if is_query_task(t):
        return 'query'
    if is_open_page_task(t):
        return 'other'
    if is_modify_task(t):
        return 'form_modify'
    if is_fill_task(t):
        return 'form_fill'
    return 'other'


def apply_task_mode(business_data_store: dict | None, task_text: str) -> TaskMode:
    """Write ``_task_mode`` / compat flags into business_data_store. Returns mode."""
    mode = classify_task_mode(task_text)
    if business_data_store is None:
        return mode
    business_data_store['_task_mode'] = mode
    business_data_store['_query_task'] = mode == 'query'
    # Legacy default; PhaseIntentContract may override via apply_phase_intent().
    business_data_store['_force_refill_all'] = (
        mode == 'form_fill'
        or (mode == 'form_modify' and force_refill_all_required(task_text))
    )
    business_data_store.pop('_query_ui', None)
    business_data_store.pop('_query_ready', None)
    business_data_store.pop('_submit_ready', None)
    if mode in ('query', 'login', 'other'):
        business_data_store.pop('task_list', None)
        business_data_store.pop('_scan_fields', None)
        business_data_store.pop('_autofill_summary', None)
    return mode

