"""Select option matching helpers (extracted from form_scan_utils.py).

form_scan_utils.py re-exports these names for backward compatibility.
"""


_SELECT_OPTION_SENTINELS = frozenset({
    'first', '1st', 'any', 'random', '第一个', '第一项',
})


def resolve_recorded_option_text(requested: str, actual: str = '') -> str:
    """Replay contract: never persist first/any/random — stamp concrete display value.

    Recording may accept sentinel option_text at runtime; the step persisted for
    replay must carry the real selected (or already-matched) label.
    """
    req = (requested or '').strip()
    act = (actual or '').strip()
    if req.lower() in _SELECT_OPTION_SENTINELS or req in _SELECT_OPTION_SENTINELS:
        return act or req
    return req or act


def select_option_already_matched(requested: str, current: str) -> bool:
    """True when the field already has the desired option — exact / sentinel only.

    Substring checks (``cur in want`` / ``want in cur``) wrongly skip re-select when
    国民经济部门类别 wants 其他非金融企业部门 but still shows 非金融企业部门.
    """
    req = (requested or '').strip()
    cur = (current or '').strip()
    if not cur:
        return False
    if req.lower() in _SELECT_OPTION_SENTINELS or req in _SELECT_OPTION_SENTINELS:
        return True
    return bool(req) and cur == req


def match_select_option_candidate(want: str, options) -> str | None:
    """Pick a dropdown option for fuzzy recovery — never shorter substring of want.

    Order: exact → shortest option that contains want as a substring.
    Does **not** use ``o in want`` (that mapped 其他非金融企业部门 → 非金融企业部门).
    """
    w = (want or '').strip()
    if not w:
        return None
    opts: list[str] = []
    seen: set[str] = set()
    for raw in options or []:
        if not isinstance(raw, str):
            continue
        o = raw.strip()
        if not o or o == '请选择' or o in seen:
            continue
        seen.add(o)
        opts.append(o)
    for o in opts:
        if o == w:
            return o
    contained = [o for o in opts if w in o]
    if contained:
        return min(contained, key=len)
    return None






