"""
Declarative form rules and data generators for Element UI form filling.

All rules are defined in the ``FIELD_RULES`` registry — no file I/O or regex
parsing at runtime.  Call ``match_rule(label_text)`` directly.

Architecture::

  FIELD_RULES (list of FieldRule)
    │
    ├── match_rule(label) → str | None
    └── get_has_button_keywords(case_data_store) → list[str]
"""
import random as _random
import os
import sys
from dataclasses import dataclass, field
from typing import Callable, List, Optional


# ══════════════════════════════════════════════════════════════════════════════
# Constants
# ══════════════════════════════════════════════════════════════════════════════

# 手机号段（34个，覆盖移动/联通/电信/虚拟运营商）
_HAODUAN = [
    '130', '131', '132', '133', '134', '135', '136', '137', '138', '139',
    '145', '147',
    '150', '151', '152', '153', '156', '157', '158', '159',
    '170',
    '176', '177', '178',
    '180', '181', '182', '183', '184', '185', '186', '187', '188', '189',
]

# 身份证前6位区划码（省+市+区县级别，覆盖主要区域）
_IDCARD_AREAS = [
    '110101', '110102', '110105', '110108', '110111', '110112', '110113',
    '120101', '120102', '120103', '120104',
    '130100', '130200', '130300', '130400', '130500', '130600',
    '140100', '140200', '140300', '140400',
    '210100', '210200', '210300', '210400', '210500',
    '220100', '220200', '220300', '220400',
    '230100', '230200', '230300', '230400',
    '310101', '310104', '310105', '310106', '310107', '310109', '310110',
    '320100', '320200', '320300', '320400', '320500', '320600',
    '330100', '330200', '330300', '330400', '330500', '330600',
    '340100', '340200', '340300', '340400', '340500',
    '350100', '350200', '350300', '350400', '350500',
    '360100', '360200', '360300', '360400', '360500',
    '370100', '370200', '370300', '370400', '370500', '370600',
    '410100', '410200', '410300', '410400', '410500',
    '420100', '420200', '420300', '420400', '420500',
    '430100', '430200', '430300', '430400', '430500', '430600',
    '440100', '440200', '440300', '440400', '440500', '440600',
    '450100', '450200', '450300', '450400',
    '500101', '500102', '500103', '500104', '500105', '500106', '500107',
    '510100', '510300', '510400', '510500', '510600', '510700',
    '520100', '520200', '520300',
    '530100', '530300', '530400', '530500',
    '610100', '610200', '610300', '610400',
    '620100', '620200', '620300',
    '650100', '650200',
]

# 银行卡BIN前缀（34种）
_BIN_PREFIXES = [
    '10', '18', '30', '35', '37', '40', '41', '42', '43', '44', '45',
    '46', '47', '48', '49', '50', '51', '52', '53', '54', '55', '56',
    '58', '60', '62', '65', '68', '69', '84', '87', '88', '94', '95', '98', '99',
]

# 统一社会信用代码：登记机构映射（GB 32100-2015）
_REG_ORG_MAP = {
    '1': 1,   # 机构编制
    '2': 2,   # 外交
    '3': 3,   # 教育
    '4': 4,   # 公安
    '5': 5,   # 民政
    '6': 6,   # 司法
    '7': 7,   # 交通运输
    '8': 8,   # 文化
    '9': 9,   # 工商
    '10': 'A',  # 旅游局
    '11': 'B',  # 宗教事务管理
    '12': 'C',  # 全国总工会
    '13': 'D',  # 人民解放军总后勤部
    '14': 'E',  # 省级人民政府
    '15': 'F',  # 地市级人民政府
    '16': 'G',  # 区县级人民政府
    '17': 'Y',  # 其他
}

# 信用代码字符集（GB 32100-2015，不含 I O S V Z）
_CC_CHARS = '0123456789ABCDEFGHJKLMNPQRTUWXY'
# 信用代码权重（ISO 7064, MOD 31-2）
_CC_WEIGHTS = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28]

# 组织机构代码权重（GB 11714-1997）
_ORG_CODE_WEIGHTS = [3, 7, 9, 10, 5, 8, 4, 2]


# ══════════════════════════════════════════════════════════════════════════════
# Generator functions
# ══════════════════════════════════════════════════════════════════════════════

def _gen_mobile() -> str:
    """11位手机号，使用真实号段。"""
    haoduan = _random.choice(_HAODUAN)
    tail = ''.join(str(_random.randint(0, 9)) for _ in range(8))
    return haoduan + tail


def _gen_idcard() -> str:
    """18位身份证号，含GB 11643-1999校验位。

    结构：6位区划码 + 8位生日 + 3位顺序码(奇男偶女) + 1位校验码。
    """
    prefix = _random.choice(_IDCARD_AREAS)
    year = 1950 + _random.randint(0, 55)
    month = _random.randint(1, 12)
    day = _random.randint(1, 28)
    birth = f"{year}{month:02d}{day:02d}"

    # 顺序码：随机生成，确保奇数为男、偶数为女
    seq = _random.randint(0, 999)
    # 保持奇偶性不强制（允许任意顺序码），如需要可外部指定性别
    # 默认生成合法身份证即可
    seq_str = f"{seq:03d}"

    base = prefix + birth + seq_str
    weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
    check = '10X98765432'[sum(int(base[i]) * weights[i] for i in range(17)) % 11]
    return base + check


def _gen_idcard_male() -> str:
    """生成男性身份证（顺序码为奇数）。"""
    prefix = _random.choice(_IDCARD_AREAS)
    year = 1950 + _random.randint(0, 55)
    month = _random.randint(1, 12)
    day = _random.randint(1, 28)
    birth = f"{year}{month:02d}{day:02d}"

    seq = _random.choice([1, 3, 5, 7, 9]) * 100 + _random.randint(0, 99)
    seq_str = f"{seq:03d}"

    base = prefix + birth + seq_str
    weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
    check = '10X98765432'[sum(int(base[i]) * weights[i] for i in range(17)) % 11]
    return base + check


def _gen_idcard_female() -> str:
    """生成女性身份证（顺序码为偶数）。"""
    prefix = _random.choice(_IDCARD_AREAS)
    year = 1950 + _random.randint(0, 55)
    month = _random.randint(1, 12)
    day = _random.randint(1, 28)
    birth = f"{year}{month:02d}{day:02d}"

    seq = _random.choice([0, 2, 4, 6, 8]) * 100 + _random.randint(0, 99)
    seq_str = f"{seq:03d}"

    base = prefix + birth + seq_str
    weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
    check = '10X98765432'[sum(int(base[i]) * weights[i] for i in range(17)) % 11]
    return base + check


def _gen_landline() -> str:
    return _random.choice(['010', '021', '0731', '0755', '0571', '028']) + ''.join(
        str(_random.randint(0, 9)) for _ in range(8))


def _gen_email() -> str:
    return f"test{_random.randint(100, 999)}@{_random.choice(['example.com', 'company.cn'])}"


def _gen_credit_code() -> str:
    """18位统一社会信用代码（GB 32100-2015）。

    结构：1位登记机构 + 1位机构类型 + 6位行政区划 + 8位组织机构代码(含校验) + 1位校验码。
    """
    # 登记机构（默认工商）
    reg_org = str(_REG_ORG_MAP['9'])
    # 机构类型（1=企业）
    org_type = '1'
    # 行政区划（6位）
    area = _random.choice(_IDCARD_AREAS)
    # 组织机构代码（8位数字 + 1位校验码，mod 11）
    org_body = ''.join(str(_random.randint(0, 9)) for _ in range(8))
    org_sum = sum(int(org_body[i]) * _ORG_CODE_WEIGHTS[i] for i in range(8))
    c9 = 11 - (org_sum % 11)
    if c9 == 11:
        c9_char = '0'
    elif c9 == 10:
        c9_char = 'X'
    else:
        c9_char = str(c9)
    org_code = org_body + c9_char

    code_body = reg_org + org_type + area + org_code
    # 校验码（ISO 7064, MOD 31-2）
    total = sum(_CC_CHARS.index(code_body[i]) * _CC_WEIGHTS[i] for i in range(17))
    c18 = _CC_CHARS[(31 - total % 31) % 31]
    return code_body + c18


def _gen_org_code() -> str:
    """9位组织机构代码（GB 11714-1997），格式 XXXXXXXX-X。

    8位数字/字母本体 + 1位校验码（mod 11，10→X）。
    """
    _ORG_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    body = ''.join(_random.choice(_ORG_CHARS) for _ in range(8))
    _weights = [3, 7, 9, 10, 5, 8, 4, 2]

    # 代码字符映射为数值
    def _cv(c):
        if '0' <= c <= '9':
            return ord(c) - 48
        return ord(c) - 55  # A=10, B=11, ...

    total = sum(_cv(body[i]) * _weights[i] for i in range(8))
    c9 = 11 - (total % 11)
    if c9 == 11:
        check = '0'
    elif c9 == 10:
        check = 'X'
    else:
        check = str(c9)
    return f"{body}-{check}"


def _gen_bankcard() -> str:
    """16-19位银行卡号，含Luhm校验位。

    结构：BIN前缀 + 中间位 + 1位Luhm校验码。
    """
    bin_prefix = _random.choice(_BIN_PREFIXES)
    # 中间位：补齐到15或18位（含BIN）
    total_before_check = 15 if _random.random() < 0.3 else 18
    mid_len = total_before_check - len(bin_prefix)
    mid = ''.join(str(_random.randint(0, 9)) for _ in range(mid_len))
    first_n = bin_prefix + mid

    # Luhm算法计算校验位（ISO/IEC 7812）
    digits = [int(ch) for ch in first_n]
    for i in range(len(digits) - 1, -1, -1):
        if (len(digits) - i) % 2 == 1:
            digits[i] *= 2
            if digits[i] > 9:
                digits[i] -= 9
    total = sum(digits)
    luhm = (10 - total % 10) % 10
    return first_n + str(luhm)


def _gen_amount() -> str:
    return f"{_random.randint(100000, 9999999)}.{_random.randint(0, 99):02d}"


def _gen_longitude() -> str:
    """China longitude ≈ 73–135, product forms often validate to 2 decimals."""
    return f"{_random.uniform(73.0, 135.0):.2f}"


def _gen_latitude() -> str:
    """China latitude ≈ 18–53, product forms often validate to 2 decimals."""
    return f"{_random.uniform(18.0, 53.0):.2f}"


def normalize_lat_lng_value(label_text: str, value: str) -> str:
    """Round 经度/纬度 fills to 2 decimal places (page validators reject 4+)."""
    t = (label_text or '').replace(' ', '').replace('\t', '')
    tl = t.lower()
    if not (
        '经度' in t or '纬度' in t
        or 'longitude' in tl or 'latitude' in tl
    ):
        return value if value is not None else ''
    s = str(value or '').strip()
    if not s:
        return s
    try:
        return f"{float(s):.2f}"
    except ValueError:
        return s


def _gen_name() -> str:
    return _random.choice(['张', '李', '王', '刘', '陈', '杨', '赵', '黄', '周', '吴']) + \
        _random.choice(['伟', '芳', '敏', '静', '丽', '强', '磊', '洋', '涛', '明']) + \
        _random.choice(['华', '平', '刚', '杰', '峰', '玲', '超', '文', '林', '军'])


def _gen_institution_credit_code() -> str:
    """10-digit institution credit code (人行征信中心分配)."""
    return ''.join(str(_random.randint(0, 9)) for _ in range(10))


def _gen_address() -> str:
    return _random.choice(['北京市朝阳区', '上海市浦东新区', '广州市天河区', '深圳市南山区', '长沙市岳麓区']) + \
        _random.choice(['中山路', '人民路', '解放路', '五一路', '芙蓉路']) + f"{_random.randint(1, 200)}号"


def _gen_qq() -> str:
    return ''.join(str(_random.randint(0, 9)) for _ in range(_random.randint(5, 11)))


def _gen_age() -> str:
    return str(_random.randint(18, 65))


def _gen_employee_id() -> str:
    return 'EMP' + f"{_random.randint(100, 999)}"


def _gen_postal_code() -> str:
    return str(_random.randint(100000, 999999))


def _gen_count() -> str:
    return str(_random.randint(1, 999999))


def _gen_percent() -> str:
    return f"{_random.randint(0, 10000) / 100:.2f}"


def _gen_phone() -> str:
    return _gen_mobile()


def _gen_year() -> str:
    return '2026'


def _gen_month() -> str:
    return f"{_random.randint(1, 12):02d}"


def _gen_quarter() -> str:
    return str(_random.randint(1, 4))


def _gen_week() -> str:
    return str(_random.randint(1, 7))


# ══════════════════════════════════════════════════════════════════════════════
# Rule registry
# ══════════════════════════════════════════════════════════════════════════════

@dataclass
class FieldRule:
    """A single field-matching rule with its generator."""
    keywords: List[str]
    generator: Callable[[], str]
    priority: int = 50
    rule_type: str = "dynamic"
    description: str = ""



# ══════════════════════════════════════════════════════════════════════════════
# Public API
# ══════════════════════════════════════════════════════════════════════════════


def match_cert_number(cert_type: str = '') -> str:
    """Generate a certificate number based on the selected 证件类型 text.

    「证件号码」 alone is ambiguous — personal forms need an ID card, corporate
    forms need a unified social credit code.  Callers should pass the current
    证件类型 / 证照类型 display value when available.
    """
    ct = (cert_type or '').replace(' ', '').replace('\t', '')
    if any(k in ct for k in ('身份证', '户口簿', '临时身份证')):
        return _gen_idcard()
    if any(k in ct for k in ('统一社会信用代码', '营业执照', '信用代码')):
        return _gen_credit_code()
    if '组织机构' in ct:
        return _gen_org_code()
    # No usable type — default to ID card (personal-customer forms are common;
    # corporate pages usually label the field 统一社会信用代码 explicitly).
    return _gen_idcard()


def match_rule(label_text):
    """Match a label against registered rules and return a generated value, or None.

    Args:
        label_text: The field label text to match.

    Match order: across all rules, prefer the longest matching keyword; ties
    break by rule.priority (higher wins).

    Ambiguous labels like「证件号码」return None — use ``match_cert_number``.
    """
    t = label_text.replace(' ', '').replace('\t', '')
    # Ambiguous — must be resolved via 证件类型 context
    if t in ('证件号码', '证件号') or t.endswith('证件号码') or t.endswith('证件号'):
        # Still allow specific compounds already covered by other rules
        # (e.g. label that also contains 身份证 / 统一社会信用代码).
        if not any(k in t for k in ('身份证', '统一社会信用代码', '信用代码', '营业执照', '组织机构')):
            return None

    best = None  # (kw_len, priority, generator)
    for rule in FIELD_RULES:
        for kw in rule.keywords:
            if kw and kw in t:
                score = (len(kw), rule.priority)
                if best is None or score > (best[0], best[1]):
                    best = (len(kw), rule.priority, rule.generator)
    if best:
        return best[2]()
    return None


# ── hasButton detection keywords ─────────────────────────────────────────────
_DEFAULT_HAS_BUTTON_KEYWORDS = ['选择', '获取地址', '引入', '新增', '添加', '验证']


def get_has_button_keywords(case_data_store=None):
    """Return button keywords used by JS_SCAN_FORM_FIELDS / JS_CHECK_SINGLE_FIELD."""
    if case_data_store:
        override = case_data_store.get('_has_button_keywords')
        if override and isinstance(override, list) and len(override) > 0:
            return [str(k) for k in override]
    env_val = os.environ.get('HAS_BUTTON_KEYWORDS', '').strip()
    if env_val:
        return [k.strip() for k in env_val.split(',') if k.strip()]
    return list(_DEFAULT_HAS_BUTTON_KEYWORDS)


from .form_rules_data import FIELD_RULES  # noqa: E402  (re-exported for compat)
