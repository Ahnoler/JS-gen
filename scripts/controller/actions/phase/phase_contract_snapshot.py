"""Apply a persisted phase contract without text recompilation."""

PHASE_CONTRACT_MODES = (
    'login', 'query', 'navigate', 'create', 'modify', 'introduce_pick', 'other',
)
PHASE_CONTRACT_KINDS = (
    'toast_ok', 'url_change', 'saved_navigation', 'query_clicked', 'page_opened',
    'nav_next_clicked', 'picker_closed', 'confirm_click', 'dialog_confirmed',
    'introduced_backfilled',
)
_SUBMIT_MODES = frozenset(('create', 'modify', 'introduce_pick'))

_MODE_TO_ROLE = {
    'create': 'maintain', 'modify': 'maintain', 'query': 'query',
    'navigate': 'navigate', 'introduce_pick': 'introduce',
    'login': 'other', 'other': 'other',
}
# 与 intent_contract._MODE_TO_TASK 一致：navigate / introduce_pick 的 task_mode 都是 other。
_MODE_TO_TASK = {
    'create': 'form_fill', 'modify': 'form_modify', 'query': 'query',
    'login': 'login', 'navigate': 'other', 'introduce_pick': 'other', 'other': 'other',
}


def normalize_phase_contract(raw):
    """Return a v1 contract dict, or None when the document is invalid."""
    if not isinstance(raw, dict):
        return None
    if raw.get('v') != 1:
        return None
    if raw.get('source') != 'analyze':
        return None
    mode = raw.get('mode')
    if mode not in PHASE_CONTRACT_MODES:
        return None
    refill = raw.get('refill')
    if refill not in ('none', 'all_editable'):
        return None
    if refill == 'all_editable' and mode not in ('create', 'modify'):
        return None
    submit_required = raw.get('submitRequired')
    if not isinstance(submit_required, bool):
        return None
    if submit_required and mode not in _SUBMIT_MODES:
        return None
    kinds = raw.get('successWhen')
    if not isinstance(kinds, list):
        return None
    success_when = []
    for kind in kinds:
        if kind not in PHASE_CONTRACT_KINDS:
            return None
        if kind not in success_when:
            success_when.append(kind)
    return {
        'v': 1,
        'mode': mode,
        'refill': refill,
        'submitRequired': submit_required,
        'successWhen': success_when,
        'source': 'analyze',
    }


def persisted_contract_from_instruction(instruction, heal_mode):
    """Raw snapshot from a step instruction, or None when heal mode ignores it."""
    if heal_mode:
        return None
    if not isinstance(instruction, dict):
        return None
    raw = instruction.get('phase_contract')
    if raw is None:
        raw = instruction.get('phaseContract')
    return raw


def apply_persisted_phase_contract(business_data_store, raw):
    """Write intent and boundary from a valid snapshot. Invalid input leaves the store unchanged."""
    if business_data_store is None:
        return None
    doc = normalize_phase_contract(raw)
    if not doc:
        return None
    mode = doc['mode']
    submit_required = doc['submitRequired']
    via = 'any'
    if submit_required and mode in ('create', 'modify'):
        via = 'click_save'
    contract = {
        'mode': mode,
        'refill': doc['refill'],
        'submit': {'required': submit_required, 'via': via, 'button_text': ''},
        'success': {'kinds': list(doc['successWhen']), 'evidence': []},
        'source': 'persisted',
        'allow_form_assistant': doc['refill'] == 'all_editable' and mode in ('create', 'modify'),
    }
    boundary = {
        'role': _MODE_TO_ROLE.get(mode, 'other'),
        'requires_write_all_editable': doc['refill'] == 'all_editable',
        'goals': [],
        'success_when': list(doc['successWhen']),
        'task_mode': _MODE_TO_TASK.get(mode, 'other'),
        'source': 'persisted',
        'forbid_index_submit': mode in ('create', 'modify'),
        'picker_allowed': mode in ('create', 'modify', 'introduce_pick'),
    }
    business_data_store['_phase_intent'] = contract
    business_data_store['_phase_intent_flag_locked'] = True
    business_data_store['_phase_boundary'] = boundary
    business_data_store['_phase_boundary_flag_locked'] = True
    business_data_store['_task_mode'] = boundary['task_mode']
    business_data_store['_query_task'] = mode == 'query'
    business_data_store['_force_refill_all'] = boundary['requires_write_all_editable']
    business_data_store['_evidence_observed'] = []
    return contract
