"""Compatibility shim — implementation moved to scripts.controller.actions.form_rules.py."""
from scripts.controller.actions.form_rules import *  # noqa: F401,F403
from scripts.controller.actions.form_rules import (  # noqa: F401
    Callable, FIELD_RULES, FieldRule, List,
    Optional, _BIN_PREFIXES, _CC_CHARS, _CC_WEIGHTS,
    _DEFAULT_HAS_BUTTON_KEYWORDS, _HAODUAN, _IDCARD_AREAS, _ORG_CODE_WEIGHTS,
    _REG_ORG_MAP, _gen_address, _gen_age, _gen_amount,
    _gen_bankcard, _gen_count, _gen_credit_code, _gen_email,
    _gen_employee_id, _gen_idcard, _gen_idcard_female, _gen_idcard_male,
    _gen_institution_credit_code, _gen_landline, _gen_mobile, _gen_month,
    _gen_name, _gen_org_code, _gen_percent, _gen_phone,
    _gen_postal_code, _gen_qq, _gen_quarter, _gen_week,
    _gen_year, _random, dataclass, field,
    get_has_button_keywords, match_cert_number, match_rule, os,
    sys,
)
