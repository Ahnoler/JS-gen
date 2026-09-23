"""核验型阶段机械判定（verify-phase-token 第一步：门侧兜底，#973）。

纯核验型阶段（重搜确认已删对象不存在——无保存动作）产不出 toast/url_change
保存令牌，却被收尾质量门按 ``missing_success_token`` 误杀。本模块提供机械可判
的「核验型」纯函数 ``is_verification_phase_task``，供 ``scripts/agent/service.py``
收尾门在 ``introduce_pick`` 豁免之后追加豁免（镜像既有 introduce_pick 例外；
仅门侧，不动合约生成链）。设计稿：
``docs/superpowers/specs/2026-09-21-verify-phase-token-caliber-design.md`` §2/§4.3。

校准对（冻结判据，不是反推词表的素材）：
- 阳性 #973：「重搜确认三个已删除节点已不存在，无数据返回」(mode=other) → True
  ——四条件全满足，判定为核验型，跳过 missing_success_token 标记；
- 对照 #924：「重搜确认已删除节点不存在，然后删除新残留节点」→ False——
  含写动词「删除」（核验+写混合阶段须保留真实终态证据要求，不豁免）。

**FP 零容忍、FN 可容忍**：任何拿不准的形态一律返回 False（维持现行判定=
误杀可容忍方向）。词表为冻结清单（子串匹配，不做归一），修订须换独立校准批
再验，禁止按错分样本回改词表。

实现注记：条件③写动词黑名单扫描前先掩蔽宾语状态词（已删除/已停用等）——
「已删除」是状态补语不是动作动词（#973 阳性要求），而裸「删除」（#924）仍命中；
条件②共现检查用原始文本（掩蔽仅为黑名单扫描服务）。
"""

from __future__ import annotations

# 冻结词表 v1（plan 判定式逐字采用；子串匹配，不做归一）。
# 条件①：保存线索词——命中任一即非核验型。
_SAVE_CUES = ("保存", "提交", "下一步", "点击确定", "点确定", "确认修改", "应用", "上传")
# 条件②：核验词根与宾语词（须 ±16 字符窗口内共现）。
_VERIFY_ROOTS = ("核验", "验证", "确认", "检查", "复核", "是否存在", "不存在")
_VERIFY_OBJECTS = (
    "已删除", "已删", "不存在", "无数据", "是否生效", "是否还存", "已停用", "是否为空",
)
# 条件③：写动词黑名单——「删除」「修改」「确定」从严（#924 排除条件）。
_WRITE_VERBS = (
    "保存", "提交", "填写", "输入", "勾选", "上传", "新增", "编辑", "修改", "删除",
    "启用", "停用", "导入", "确定",
)
# 条件④：mode/boundary_role 侧证——明确落入 veto 集才否决；缺失/未知不否决。
_MODE_SIDEBAND_VETO = ("create", "modify", "introduce_pick", "login")
_BOUNDARY_ROLE_VETO = ("maintain", "introduce", "login")
# 条件②共现窗口：词根出现位置前 16 / 后 16 字符。
_COOCCUR_WINDOW = 16


def _find_all(text: str, word: str) -> list[int]:
    """Return all start offsets of ``word`` in ``text`` (overlapping allowed)."""
    positions: list[int] = []
    start = 0
    while True:
        idx = text.find(word, start)
        if idx < 0:
            return positions
        positions.append(idx)
        start = idx + 1


def _mask_objects(text: str) -> str:
    """Mask object-word occurrences (same length) for the write-verb scan.

    「已删除」「已停用」等状态描写含写动名字面（删除/停用）但不是动作——先
    掩蔽再扫黑名单，避免 #973 阳性被「删除」误杀；裸写动词不受影响。
    """
    chars = list(text)
    for obj in _VERIFY_OBJECTS:
        for idx in _find_all(text, obj):
            for off in range(len(obj)):
                chars[idx + off] = "□"
    return "".join(chars)


def _text_conditions_pass(task_text: str) -> bool:
    """文本面三条件（①无保存线索 ②核验词根与宾语词 ±16 共现 ③写动词黑名单
    零命中——宾语状态词先掩蔽）。

    四条件判定式的文本共同部分（单源共享）：``is_verification_phase_task``
    在条件④（mode/boundary_role 侧证）之后调用本函数；persisted 合约侧
    ``phase_contract_snapshot.downgrade_contract_for_verification``（设计稿
    §6）直接调用本函数（持久化 mode 是被怀疑误标的对象，不作侧证，弃条件④）。
    两处调用走同一代码路径，文本判定口径不漂移。
    """
    if not isinstance(task_text, str) or not task_text:
        return False
    for cue in _SAVE_CUES:
        if cue in task_text:
            return False
    masked = _mask_objects(task_text)
    for verb in _WRITE_VERBS:
        if verb in masked:
            return False
    for root in _VERIFY_ROOTS:
        for idx in _find_all(task_text, root):
            window = task_text[
                max(0, idx - _COOCCUR_WINDOW): idx + len(root) + _COOCCUR_WINDOW
            ]
            if any(obj in window for obj in _VERIFY_OBJECTS):
                return True
    return False


def is_verification_phase_task(
    task_text: str, contract: dict | None, boundary_role: str | None = None
) -> bool:
    """机械判定阶段是否「纯核验型」（四条件全满足才 True；拿不准一律 False）。

    四条件（词表冻结，见模块 docstring）：
      ① 无保存线索：task_text 不含任一 ``_SAVE_CUES`` 词；
      ② 共现：含核验词根，且任一词根出现位置 ±16 字符窗口内含宾语词；
      ③ 写动词黑名单零命中（宾语状态词先掩蔽）；
      ④ mode 侧证：mode 明确为 create/modify/introduce_pick/login → False，
         缺失/未知/{query,other,navigate} → 不否决；boundary_role ∈
         {maintain, introduce, login} → 直接 False，None 不否决。
      ①②③ 走共享 helper ``_text_conditions_pass``（文本面判定单源）。

    :param task_text: 阶段任务文本（完整 task_text，非截断 excerpt）
    :param contract: 阶段意图合约（可为 None——条件④不否决也不加分）
    :param boundary_role: boundary 角色（可 None；维持硬排除面 {maintain,
        introduce, login}）
    :returns: True = 纯核验型（门侧跳过 missing_success_token）；False = 维持
        现行判定（FP 零容忍：拿不准一律 False）
    """
    if not isinstance(task_text, str) or not task_text:
        return False
    if boundary_role is not None and boundary_role in _BOUNDARY_ROLE_VETO:
        return False
    mode = (contract or {}).get('mode')
    if mode in _MODE_SIDEBAND_VETO:
        return False
    return _text_conditions_pass(task_text)
