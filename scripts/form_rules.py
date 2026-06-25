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
    CHARS = '0123456789ABCDEFGHJKLMNPQRTUWXY'
    # 前2位：登记管理部门(9=市场监管)+机构类别(1=企业)
    body = '91'
    # 第3-8位：6位行政区划代码
    body += f"{_random.randint(100000, 999999)}"
    # 第9-17位：9位主体标识码（字母/数字随机）
    for _ in range(9):
        body += _random.choice(CHARS)
    # 第18位：校验码（ISO 7064:1983 MOD 31）
    WEIGHTS = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28]
    total = sum(CHARS.index(body[i]) * WEIGHTS[i] for i in range(17))
    return body + CHARS[(31 - total % 31) % 31]

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
    'genBankCard': _gen_bankcard,  # JS naming alias
    'genAmount': _gen_amount, 'genName': _gen_name, 'genAddress': _gen_address,
    'genQQ': lambda: ''.join(str(_random.randint(0,9)) for _ in range(_random.randint(5,11))),
    'genAge': lambda: str(_random.randint(18,65)),
    'genEmployeeId': lambda: 'EMP' + f"{_random.randint(100,999)}",
}


def load_rules(script_dir=None):
    """Load form rules from ATP skill SKILL.md — single source of truth."""
    if script_dir is None:
        script_dir = os.path.dirname(os.path.abspath(__file__))
    
    skill_path = os.path.join(script_dir, '..', '.opencode', 'skills', 'atp-rule', 'SKILL.md')
    if not os.path.exists(skill_path):
        sys.stderr.write(f"[rules] SKILL.md not found at {skill_path}, no rules loaded\n")
        sys.stderr.flush()
        return []
    
    try:
        with open(skill_path, 'r', encoding='utf-8') as f:
            content = f.read()
    except:
        sys.stderr.write(f"[rules] Failed to read SKILL.md\n")
        sys.stderr.flush()
        return []
    
    rules = []
    
    # Parse generator table: | `关键词1`、`关键词2`... | `genFunc()` | ... |
    gen_table = re.findall(r'\|\s*`([^`]+(?:`、`[^`]+)*)`\s*\|\s*`(\w+)\(\)`', content)
    for keywords_str, func_name in gen_table:
        kws = [k.strip() for k in keywords_str.replace('`', '').split('、')]
        gen = _GEN_MAP.get(func_name)
        if gen:
            rules.append((kws, gen))
    
    # Parse format templates: | `关键词`... | format spec | example |
    fmt_rows = re.findall(r'\| `([^`]+)`\s*\|([^|]+?)\s*\|[^|]*\|', content)
    for keywords_str, spec in fmt_rows:
        kws = [k.strip().replace('`','') for k in keywords_str.split('、')]
        spec_text = spec.strip().replace('`', '').strip()
        rules.append((kws, lambda s=spec_text: s))
    
    # Parse code value selects: | `关键词`... | `可选值`... | description |
    sel_rows = re.findall(r'\| `([^`]+)`\s*\| `([^`]+)`\s*\|', content)
    for keywords_str, options_str in sel_rows:
        kws = [k.strip().replace('`','') for k in keywords_str.split('、')]
        opts_text = options_str.replace('`', '').strip()
        rules.append((kws, lambda o=opts_text: f'SELECT: {o}. Choose based on context.'))
    
    # Also load rules from agent-field-rules.md (agent style rule tables)
    field_rules_path = os.path.join(script_dir, 'prompts', 'agent-field-rules.md')
    if os.path.exists(field_rules_path):
        try:
            with open(field_rules_path, 'r', encoding='utf-8') as f:
                field_content = f.read()
            # Parse keyword => value tables: | keyword1、keyword2、... | rule description | example |
            field_rows = re.findall(r'\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|', field_content)
            for row in field_rows:
                keywords_str = row[0].strip()
                spec = row[1].strip()
                # Only process rows where keywords look like Chinese text (not headers, not empty)
                if not keywords_str or keywords_str.startswith('[') or keywords_str.startswith('-') or keywords_str.startswith('字段') or keywords_str.startswith('证件') or keywords_str.startswith('推导') or keywords_str.startswith('其他'):
                    continue
                kws = [k.strip() for k in keywords_str.replace('、', ',').split(',') if k.strip()]
                if not kws:
                    continue
                # Generate value based on spec
                rule_text = f"{spec} — {row[2].strip()}" if row[2].strip() else spec
                rules.append((kws, lambda s=rule_text: s))
        except Exception as e:
            sys.stderr.write(f"[rules] Failed to parse agent-field-rules.md: {e}\n")
            sys.stderr.flush()

    sys.stderr.write(f"[rules] Loaded {len(rules)} rule groups from SKILL.md + agent-field-rules.md\n")
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
