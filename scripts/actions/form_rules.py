"""
Declarative form rules and data generators for Element UI form filling.

All rules are defined in the ``FIELD_RULES`` registry — no file I/O or regex
parsing at runtime.  Call ``match_rule(label_text)`` directly.

Architecture::

  FIELD_RULES (list of FieldRule)
    │
    ├── match_rule(label) → str | None
    ├── load_rules()       → list of (keywords, generator)  (deprecated)
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


# ── Lookup helper ──────────────────────────────────────────────────────

def _make_field_rules() -> List[FieldRule]:
    """Build the complete rule registry.  Rules are tried in list order;
    longer keywords within a rule are tried first to prefer specific matches.
    """
    return [
        # ── Identity & certificates (priority 90-100) ──
        FieldRule(["身份证", "身份证号", "居民身份证"], _gen_idcard, 100, "dynamic",
                  "18位身份证号，含GB 11643-1999校验位，随机性别"),
        # NOTE: Do NOT bind bare「证件号码」here — it is ambiguous (身份证 vs 统一社会信用代码).
        # Use match_cert_number(cert_type) / match_form_rule which reads 证件类型 from the page.
        FieldRule(["统一社会信用代码", "信用代码", "营业执照", "营业执照号"],
                  _gen_credit_code, 100, "dynamic",
                  "18位统一社会信用代码，GB 32100-2015标准，含登记机构/类型/区划/组织代码/校验码"),
        FieldRule(["组织机构代码", "组织代码"], _gen_org_code, 100, "dynamic",
                  "9位组织机构代码，GB 11714-1997标准，XXXXXXXX-X格式，含mod11校验位"),
        FieldRule(["机构信用代码"], _gen_institution_credit_code, 95, "dynamic",
                  "10位机构信用代码（人行征信中心分配）"),

        # ── Contact (priority 85-95) ──
        FieldRule(["手机号码", "联系电话", "手机", "电话", "联系方式", "电话号码", "手机号"],
                  _gen_mobile, 95, "dynamic", "11位手机号，34种真实号段(130-189)"),
        FieldRule(["单位电话", "固定电话", "座机"], _gen_landline, 90, "dynamic",
                  "区号+8位号码"),
        FieldRule(["邮箱", "Email", "电子邮箱"], _gen_email, 85, "dynamic",
                  "随机用户名+常见域名"),

        # ── Finance (priority 80-90) ──
        FieldRule(["银行卡", "银行卡号", "银行账号"], _gen_bankcard, 85, "dynamic",
                  "16-19位，34种BIN前缀，含Luhm校验位"),
        FieldRule(["金额", "价格", "费用", "工资", "收入"], _gen_amount, 80, "dynamic",
                  "10000.00～9999999.99随机金额"),

        # ── Personal (priority 75-80) ──
        FieldRule(["姓名", "用户名", "联系人"], _gen_name, 80, "dynamic",
                  "2-4字随机中文姓名"),
        FieldRule(["地址", "详细地址", "联系地址"], _gen_address, 75, "dynamic",
                  "省市区+街道+门牌号"),
        FieldRule(["QQ", "QQ号", "QQ号码"], _gen_qq, 70, "dynamic",
                  "5-11位随机数字"),
        FieldRule(["年龄"], _gen_age, 65, "dynamic", "18-65随机"),
        FieldRule(["工号", "员工编号"], _gen_employee_id, 65, "dynamic",
                  "EMP+3位数字"),
        FieldRule(["邮编", "邮政编码"], _gen_postal_code, 60, "dynamic",
                  "6位随机数字"),

        # ── Date / time (priority 60-70) ──
        FieldRule(["成立日期", "登记日期", "注册日期", "设立日期", "创办日期", "开业日期"],
                  lambda: f"{_random.randint(2016,2025)}-{_random.randint(1,12):02d}-{_random.randint(1,28):02d}",
                  70, "semantic", "过去日期，当前日期前1~10年"),
        FieldRule(["失效日期", "到期日期", "截止日期", "期满日期", "预计日期"],
                  lambda: f"{_random.randint(2027,2036)}-{_random.randint(1,12):02d}-{_random.randint(1,28):02d}",
                  70, "semantic", "未来日期，当前日期后1~10年"),
        FieldRule(["年份", "年度"], _gen_year, 65, "semantic", "当前年份"),
        FieldRule(["月份", "月度"], _gen_month, 60, "semantic", "1-12"),
        FieldRule(["季度"], _gen_quarter, 60, "semantic", "1-4"),
        FieldRule(["周", "星期"], _gen_week, 60, "semantic", "1-7"),

        # ── Numeric (priority 50-65) ──
        FieldRule(["人数", "员工人数", "职工人数", "党员人数", "从业人数", "人员数量"],
                  lambda: str(_random.randint(10, 99999)), 55, "semantic",
                  "10～99999随机正整数"),
        FieldRule(["数量", "件数", "个数", "套数", "份数"], _gen_count, 55, "semantic",
                  "1～999999随机正整数"),
        FieldRule(["比例", "比率", "利率", "费率", "税率", "折扣", "占比", "份额"],
                  _gen_percent, 50, "semantic", "0-100百分比"),
        FieldRule(["股票代码"], lambda: str(_random.randint(100000, 999999)), 50, "semantic",
                  "6位随机数字"),
        FieldRule(["注册资本", "实收资本", "资本", "出资额", "投资额", "注册资金"],
                  lambda: str(_random.randint(100000, 1000000000)), 55, "semantic",
                  "正整数 10000～1000000000"),
        FieldRule(["价格", "单价", "售价", "原价", "现价", "市场价"],
                  lambda: f"{_random.randint(10, 9999999)}.{_random.randint(0,99):02d}", 50, "semantic",
                  "10.00～9999999.99"),
        FieldRule(["年限", "期限", "有效期", "使用年限", "有效期(年)"],
                  lambda: str(_random.randint(1, 50)), 50, "semantic",
                  "1-50年"),

        # ── Codes / IDs (priority 50-60) ──
        FieldRule(["行政编号", "行政区划代码", "行政区划编码"], lambda: str(_random.randint(100000, 999999)),
                  60, "semantic", "6位行政编号"),
        FieldRule(["客户编号", "客户号", "客户ID"], lambda: 'C' + ''.join(str(_random.randint(0,9)) for _ in range(8)),
                  55, "semantic", "C+8位数字"),
        FieldRule(["产品编码", "产品编号", "产品代码"], lambda: 'P' + ''.join(str(_random.randint(0,9)) for _ in range(6)),
                  55, "semantic", "P+6位数字"),
        FieldRule(["合同编号", "合同号", "协议编号"],
                  lambda: f"CT{_random.randint(202001, 203012)}{_random.randint(1,999):03d}", 55, "semantic",
                  "CT+年月+序号"),
        FieldRule(["项目编号", "项目编码", "项目号"],
                  lambda: f"PRJ{_random.randint(202001, 203012)}{_random.randint(1,999):03d}", 55, "semantic",
                  "PRJ+年月+序号"),
        FieldRule(["交易编号", "交易流水号", "流水号"],
                  lambda: 'TXN' + ''.join(str(_random.randint(0,9)) for _ in range(11)), 50, "semantic",
                  "TXN+11位数字"),
        FieldRule(["订单编号", "订单号"],
                  lambda: f"2026{_random.randint(1,12):02d}{_random.randint(1,28):02d}{_random.randint(1,999999):06d}", 50, "semantic",
                  "年月日+6位序号"),
        FieldRule(["档案编号", "档案号"], lambda: 'DA' + ''.join(str(_random.randint(0,9)) for _ in range(8)),
                  50, "semantic", "DA+8位数字"),
        FieldRule(["凭证编号", "凭证号"], lambda: 'PZ' + ''.join(str(_random.randint(0,9)) for _ in range(8)),
                  50, "semantic", "PZ+8位数字"),
        FieldRule(["序列号", "SN"], lambda: 'SN' + ''.join(str(_random.randint(0,9)) for _ in range(10)),
                  45, "semantic", "SN+10位数字"),
        FieldRule(["账号", "账户号"], lambda: '622202' + ''.join(str(_random.randint(0,9)) for _ in range(8)),
                  45, "semantic", "622202+8位数字"),
        FieldRule(["登记编号", "备案号"],
                  lambda: f"BD{_random.randint(202001, 203012)}{_random.randint(1,999):03d}", 45, "semantic",
                  "BD+年月+序号"),
        FieldRule(["批号", "批次号"],
                  lambda: f"2026{_random.randint(1,12):02d}{_random.randint(1,28):02d}{_random.randint(1,99):02d}", 45, "semantic",
                  "年月日+2位序号"),

        # ── Address / Region (priority 45-55) ──
        # Short keywords (省/市/区) are matched with exact-ish guards in match_rule
        # to avoid「行政区划编码」→「区」false positives.
        FieldRule(["省", "省份", "所在省"], lambda: _random.choice(['湖南省', '广东省', '浙江省', '江苏省', '山东省', '湖北省']),
                  55, "semantic", "省级行政区名称"),
        FieldRule(["市", "城市", "所在市"], lambda: _random.choice(['长沙市', '广州市', '杭州市', '南京市', '济南市', '武汉市']),
                  55, "semantic", "地级市名称"),
        FieldRule(["所在区", "城区"], lambda: _random.choice(['岳麓区', '天河区', '西湖区', '鼓楼区', '历下区', '武昌区']),
                  55, "semantic", "区县级名称"),
        FieldRule(["街道", "乡镇"], lambda: _random.choice(['麓谷街道', '天顶街道', '天河南街道', '西溪街道']),
                  50, "semantic", "街道/乡镇名称"),
        FieldRule(["村", "行政村"], lambda: 'XX村', 45, "semantic", "村级名称占位符"),
        FieldRule(["门牌号", "详细地址"], lambda: f"{_random.randint(1,200)}号{_random.choice(['','XX室'])}",
                  50, "semantic", "门牌号"),

        # ── Select / Status (priority 40-50) ──
        FieldRule(["状态", "状态位", "标志"], lambda: _random.choice(['正常', '启用', '有效']), 50, "static",
                  "常见状态"),
        FieldRule(["类型", "类别", "分类", "种类"], lambda: _random.choice(['企业类', '个人类', '机关类']), 50, "static",
                  "常见类型"),
        FieldRule(["等级", "级别", "评级"], lambda: _random.choice(['A级', 'B级', '一般', 'C级']), 50, "static",
                  "常见等级"),
        FieldRule(["性质", "属性"], lambda: _random.choice(['企业法人', '事业单位', '社会团体']), 50, "static",
                  "常见性质"),
        FieldRule(["来源", "来源渠道"], lambda: _random.choice(['系统录入', '批量导入']), 45, "static",
                  "常见来源"),
        FieldRule(["方式", "方法", "模式"], lambda: _random.choice(['线上', '线下']), 45, "static",
                  "常见方式"),
        FieldRule(["用途", "使用用途", "资金用途"], lambda: _random.choice(['生产经营', '流动资金', '项目投资']),
                  45, "static", "常见用途"),
        FieldRule(["币种", "货币"], lambda: 'CNY', 50, "static", "ISO币种代码"),
        FieldRule(["语言", "语种"], lambda: '中文', 50, "static", "常见语言"),
        FieldRule(["方向", "流向"], lambda: _random.choice(['流入', '流出', '转入', '转出']), 45, "static",
                  "常见方向"),

        # ── Name / Text (priority 40-55) ──
        # Put specific name rules BEFORE the generic「名称」rule.
        FieldRule(["工作单位区域", "单位区域"], lambda: _random.choice(['岳麓区', '天河区', '西湖区', '鼓楼区']),
                  62, "semantic", "工作单位所在区域"),
        FieldRule(["外文名称", "英文名称", "英文名"], lambda: 'Test Customer', 60, "semantic", "英文/外文名称"),
        FieldRule(["工作单位", "任职单位", "所在单位"], lambda: '测试科技有限公司', 60, "semantic", "工作单位名称"),
        FieldRule(["客户名称", "公司名称", "企业名称", "单位名称", "全称"],
                  lambda: '测试科技发展有限公司', 55, "semantic", "中文名称"),
        FieldRule(["简称", "缩写", "短名"], lambda: '测试科技', 50, "semantic", "中文简称"),
        FieldRule(["产品名称", "项目名称", "方案名称", "品牌名称"], lambda: '自动化测试项目',
                  50, "semantic", "业务相关名称"),
        FieldRule(["备注", "说明", "描述", "摘要", "简介"], lambda: '系统自动生成测试数据', 45, "semantic",
                  "简要说明文本"),
        FieldRule(["标题", "主题"], lambda: '关于XX的申请', 45, "semantic", "简短标题"),
        FieldRule(["合同名称", "协议名称"], lambda: '信贷合同2026001', 45, "semantic", "合同类型+编号"),
        FieldRule(["经营范围", "业务范围"], lambda: '计算机技术开发、技术服务', 45, "semantic", "标准经营范围"),
        FieldRule(["所属行业", "行业类别", "行业"], lambda: '软件和信息技术服务业', 45, "semantic", "常见行业分类"),
        FieldRule(["所属部门", "部门名称", "科室"], lambda: _random.choice(['技术部', '风控部', '信贷部']),
                  45, "semantic", "常见部门名称"),
        FieldRule(["职务", "职位", "岗位"], lambda: _random.choice(['经理', '主管', '工程师']), 45, "semantic",
                  "常见企业职务"),
        FieldRule(["学历", "文化程度"], lambda: _random.choice(['本科', '硕士', '大专']), 45, "semantic",
                  "标准学历选项"),
        FieldRule(["学位"], lambda: _random.choice(['学士', '硕士', '博士']), 45, "semantic", "标准学位选项"),
        FieldRule(["民族"], lambda: _random.choice(['汉族', '苗族', '土家族', '回族', '蒙古族']), 45, "semantic",
                  "中国56个民族"),
        FieldRule(["国籍"], lambda: '中华人民共和国', 50, "semantic", "国家名称"),
        FieldRule(["性别"], lambda: _random.choice(['男', '女']), 50, "semantic", "性别"),
        FieldRule(["婚姻状况"], lambda: _random.choice(['未婚', '已婚']), 45, "semantic", "婚姻状态"),
        FieldRule(["政治面貌"], lambda: _random.choice(['群众', '中共党员']), 45, "semantic", "政治身份"),
        FieldRule(["开户银行", "开户行"], lambda: '中国工商银行', 50, "semantic", "常见银行名称"),
        FieldRule(["银行网点", "支行"], lambda: 'XX支行', 45, "semantic", "银行网点名称"),
        FieldRule(["证件类型", "证照类型", "证件种类"],
                  lambda: _random.choice(['身份证', '营业执照', '统一社会信用代码']), 50, "semantic",
                  "常见证件类型"),
        # Generic「单位」计量词 — only exact/short labels, not 工作单位/单位电话/…
        FieldRule(["计量单位"], lambda: _random.choice(['个', '套', '元', '万元']), 40, "static", "常见计量单位"),
        FieldRule(["时间", "时分秒"], lambda: "14:30:00", 40, "static", "当前时间点"),
        FieldRule(["开始时间", "起始时间", "生效时间"], lambda: "09:00:00", 40, "static", "开始时间"),
        FieldRule(["结束时间", "截止时间", "终止时间"], lambda: "18:00:00", 40, "static", "结束时间"),
    ]


FIELD_RULES: List[FieldRule] = _make_field_rules()


# ══════════════════════════════════════════════════════════════════════════════
# Public API
# ══════════════════════════════════════════════════════════════════════════════

def load_rules(script_dir=None):
    """Legacy wrapper — returns list of (keywords, generator) tuples.

    Deprecated: use ``match_rule(label)`` directly instead.
    """
    return [(list(r.keywords), r.generator) for r in FIELD_RULES]


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


def match_rule(label_text, form_rules=None):
    """Match a label against registered rules and return a generated value, or None.

    Args:
        label_text: The field label text to match.
        form_rules: Ignored (kept for backward compatibility with callers
                    that pass previously-loaded rules).

    Match order: across all rules, prefer the longest matching keyword; ties
    break by rule.priority (higher wins).

    Ambiguous labels like「证件号码」return None — use ``match_cert_number``.
    """
    if form_rules is not None:
        # Legacy call path — ignore the parameter and use FIELD_RULES
        pass

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
