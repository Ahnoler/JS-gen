"""Field-rule registry data (extracted verbatim from scripts/controller/actions/form_rules.py).

FIELD_RULES is built here; form_rules.py imports it back at the end of the
module (generators / FieldRule stay in form_rules.py).
"""
import random as _random
from typing import List

# FieldRule is defined before form_rules.py's trailing FIELD_RULES import,
# so this module-level import resolves against the partially-loaded module.
from .form_rules import FieldRule  # noqa: E402


# ── Lookup helper ──────────────────────────────────────────────────────

def _make_field_rules() -> List[FieldRule]:
    """Build the complete rule registry.  Rules are tried in list order;
    longer keywords within a rule are tried first to prefer specific matches.
    """

    from .form_rules import (  # noqa: F401  (lazy — avoid module-level cycle)
        _gen_idcard,
        _gen_credit_code,
        _gen_org_code,
        _gen_institution_credit_code,
        _gen_mobile,
        _gen_landline,
        _gen_email,
        _gen_bankcard,
        _gen_amount,
        _gen_longitude,
        _gen_latitude,
        _gen_name,
        _gen_address,
        _gen_qq,
        _gen_age,
        _gen_employee_id,
        _gen_postal_code,
        _gen_year,
        _gen_month,
        _gen_quarter,
        _gen_week,
        _gen_count,
        _gen_percent,
    )

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
        FieldRule(["经度", "GPS经度", "地理经度", "longitude"], _gen_longitude, 85, "dynamic",
                  "中国经度范围，保留2位小数"),
        FieldRule(["纬度", "GPS纬度", "地理纬度", "latitude"], _gen_latitude, 85, "dynamic",
                  "中国纬度范围，保留2位小数"),

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
