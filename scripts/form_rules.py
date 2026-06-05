"""
Form rules and data generators for Element UI form filling.
"""
import random as _random
import re
import os
import json
import sys

def _gen_mobile():
    return '1' + str(_random.choice([3,4,5,6,7,8,9])) + ''.join(str(_random.randint(0,9)) for _ in range(9))

def _gen_idcard():
    prefix = '430101'
    birth = f"{1950+_random.randint(0,55)}{_random.randint(1,12):02d}{_random.randint(1,28):02d}"
    seq = f"{_random.randint(0,999):03d}"
    base = prefix + birth + seq
    weights = [7,9,10,5,8,4,2,1,6,3,7,9,10,5,8,4,2]
    check = '10X98765432'[sum(int(base[i])*weights[i] for i in range(17)) % 11]
    return base + check

def _gen_landline():
    return _random.choice(['010','021','0731','0755','0571','028']) + ''.join(str(_random.randint(0,9)) for _ in range(8))

def _gen_email():
    return f"test{_random.randint(100,999)}@{_random.choice(['example.com','company.cn'])}"

def _gen_credit_code():
    return f"91{_random.randint(10,99)}{_random.randint(10,99)}" + ''.join(_random.choice('ABCDEFGHJKLMNPQRTUWXY0123456789') for _ in range(9)) + _random.choice('0123456789ABCDEFGHJKLMNPQRTUWXY')

def _gen_bankcard():
    return '62' + ''.join(str(_random.randint(0,9)) for _ in range(17))

def _gen_amount():
    return f"{_random.randint(100000,9999999)}.{_random.randint(0,99):02d}"

def _gen_name():
    return _random.choice(['张','李','王','刘','陈','杨','赵','黄','周','吴']) + _random.choice(['伟','芳','敏','静','丽','强','磊','洋','涛','明']) + _random.choice(['华','平','刚','杰','峰','玲','超','文','林','军'])

def _gen_address():
    return _random.choice(['北京市朝阳区','上海市浦东新区','广州市天河区','深圳市南山区','长沙市岳麓区']) + _random.choice(['中山路','人民路','解放路','五一路','芙蓉路']) + f"{_random.randint(1,200)}号"

_GEN_MAP = {
    'genIdCard': _gen_idcard, 'genMobile': _gen_mobile, 'genLandline': _gen_landline,
    'genEmail': _gen_email, 'genCreditCode': _gen_credit_code, 'genBankcard': _gen_bankcard,
    'genAmount': _gen_amount, 'genName': _gen_name, 'genAddress': _gen_address,
}

_FALLBACK_RULES = [
    (['身份证','身份证号','证件号码','居民身份证'], _gen_idcard),
    (['单位电话','固定电话','座机'], _gen_landline),
    (['手机','电话','联系方式'], _gen_mobile),
    (['邮箱','Email','电子邮箱'], _gen_email),
    (['信用代码','统一社会信用代码'], _gen_credit_code),
    (['银行卡','银行卡号','银行账号'], _gen_bankcard),
    (['金额','价格','费用','工资','收入'], _gen_amount),
    (['姓名','用户名','联系人'], _gen_name),
    (['地址','详细地址','联系地址'], _gen_address),
    (['QQ','QQ号','QQ号码'], lambda: ''.join(str(_random.randint(0,9)) for _ in range(_random.randint(5,11)))),
    (['年龄'], lambda: str(_random.randint(18,65))),
    (['邮编','邮政编码'], lambda: '100000'),
    (['案例类型','类型'], lambda: 'SELECT: 功能测试 / 性能测试 / 安全测试 / 兼容性测试 / 回归测试. Choose based on test context.'),
    (['案例性质','性质'], lambda: 'SELECT: 正向案例 / 反向案例. Choose based on test context.'),
    (['预期结果','预期'], lambda: 'FORMAT: Each line starts with ^^N^^ (N=1,2,3...). Example:\n^^1^^ 交易状态，[成功/失败]\n^^2^^ 系统提示[具体描述]\nPositive case → describe success. Negative case → describe rejection/error.'),
    (['操作步骤'], lambda: 'FORMAT: Numbered lines "N、操作描述". Reference elements with <<name>>, fields with 「name」.'),
    (['案例名称','名称'], lambda: 'FORMAT: 正向: "验证[功能]正向流程". 反向: "反向验证：[场景]"'),
    (['案例描述','描述'], lambda: 'FORMAT: 1-3 sentences. Example: "1. 系统应正确处理正常输入\\n2. 提交后出现操作成功提示"'),
    (['前置条件','前置'], lambda: 'FORMAT: Pre-condition state. Example: "已登录系统，进入XX页面"'),
    (['测试数据','数据'], lambda: 'FORMAT: Key-value pairs. Example: 客户名称：空值\\n证件号码：110101199001011234'),
    (['测试意图','意图','检查点'], lambda: 'FORMAT: 1-2 sentences. Example: "验证新增潜客时输入非法数据，系统应拦截并提示错误"'),
]


def load_rules(script_dir=None):
    """Load form rules from ATP skill SKILL.md, falling back to _FALLBACK_RULES."""
    if script_dir is None:
        script_dir = os.path.dirname(os.path.abspath(__file__))
    
    skill_path = os.path.join(script_dir, '..', '.opencode', 'skills', 'atp-rule', 'SKILL.md')
    if not os.path.exists(skill_path):
        sys.stderr.write(f"[rules] SKILL.md not found at {skill_path}, using fallback\n")
        sys.stderr.flush()
        return _FALLBACK_RULES[:]
    
    try:
        with open(skill_path, 'r', encoding='utf-8') as f:
            content = f.read()
    except:
        return _FALLBACK_RULES[:]
    
    rules = []
    
    # Parse generator table
    gen_table = re.findall(r'\| `([^`]+)`.*?\| `(\w+)\(\)`', content)
    for keywords_str, func_name in gen_table:
        kws = [k.strip() for k in keywords_str.replace('`', '').split('、')]
        gen = _GEN_MAP.get(func_name)
        if gen:
            rules.append((kws, gen))
    
    # Parse select options
    sel_rows = re.findall(r'码值选择[\s\S]*?\| `([^`]+)`.*?\| `([^`]+)`[^|]*?\|', content)
    for keywords_str, options_str in sel_rows:
        kws = [k.strip() for k in keywords_str.split('、')]
        opts = options_str.replace('`', '').replace(' / ', ' / ').strip()
        rules.append((kws, lambda o=opts: f'SELECT: {o}. Choose based on test context.'))
    
    # Parse format templates
    fmt_rows = re.findall(r'格式模板[\s\S]*?\| `([^`]+)`.*?\|([^|]+?)\|', content)
    for keywords_str, spec in fmt_rows:
        kws = [k.strip() for k in keywords_str.split('、')]
        spec_text = spec.strip()
        rules.append((kws, lambda s=spec_text: s))
    
    # Append extra fallback rules
    rules.append((['QQ','QQ号','QQ号码'], lambda: ''.join(str(_random.randint(0,9)) for _ in range(_random.randint(5,11)))))
    rules.append((['年龄'], lambda: str(_random.randint(18,65))))
    rules.append((['邮编','邮政编码'], lambda: '100000'))
    
    sys.stderr.write(f"[rules] Loaded {len(rules)} rule groups\n")
    sys.stderr.flush()
    return rules


def match_rule(label_text, form_rules):
    """Match a label against loaded form rules and return generated value, or None."""
    t = label_text.replace(' ','').replace('\t','')
    for keywords, gen in form_rules:
        for kw in keywords:
            if kw in t:
                return gen()
    return None
