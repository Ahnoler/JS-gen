"""Quick smoke for locator persistence + mapper."""
from scripts.actions._js_snippets import JS_SMART_LOCATOR, JS_ENRICH_CLICK_LOCATOR
from scripts.manual_recorder.mapper import _map_dom_event_to_action, _build_xpath_smart

assert 'buildLocatorSnap' in JS_SMART_LOCATOR
assert 'normalizeTargetRoot' in JS_ENRICH_CLICK_LOCATOR

e = _map_dom_event_to_action({
    'kind': 'click',
    'text': '确定',
    'tag': 'button',
    'xpath_smart': "//button[normalize-space()='确定']",
    'xpath_abs': '/button[1]',
    'attributes': {'class': 'el-button'},
    'locator_verified': True,
    'locator_strategy': 'xpath_smart',
    'candidates': [{'type': 'xpath_smart', 'value': "//button[normalize-space()='确定']"}],
})
assert e and e[0] == 'click_element_by_index'
assert e[2]['xpath_smart']
assert e[2]['locator_strategy'] == 'xpath_smart'

# Offline rebuild still works for buttons
assert _build_xpath_smart('button', '保存', '', 'el-button') == "//button[normalize-space()='保存']"
# Must NOT invent menu from /ul/li/
assert _build_xpath_smart('li', '客户管理', '/ul[1]/li[2]', '') == ''
print('python-smoke: OK')
