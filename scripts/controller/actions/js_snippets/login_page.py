"""
JS snippet constant: JS_LOGIN_PICK_LEGAL — 法人下拉自动选择（登录页专用）。

用途：LoginEngine.login 在填用户名之前调用，自动在 Element UI el-select
法人下拉中选中法人。非登录页调用时因找不到 placeholder 含「法人」的 input
而返回 {"ok":false,"error":"legal-input-not-found"}，上层静默跳过。

实测依据（天阳信贷系统登录页 http://test.creditv5p2.tansun.com.cn/）：
- 法人下拉为 el-select，input[placeholder="请选择法人"]；
- 展开必须真实 mousedown（合成 mousedown/mouseup/click 到 .el-select wrapper）；
- 选项是可见的 .el-select-dropdown__item（精确 trim 文本匹配，共 7 个法人）。

不被 scripts/controller/actions/_js_snippets.py re-export（login 引擎直接从
本模块导入）；legal_name 不暴露给 LLM 层（_form.py 的 login 包装不动）。
"""

JS_LOGIN_PICK_LEGAL = r'''async (args) => {
  const legalName = Array.isArray(args) ? String(args[0] || '') : String(args || '');
  const fire = (el, type) => {
    const ev = new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX: 1, clientY: 1 });
    el.dispatchEvent(ev);
  };
  const visible = (el) => {
    if (!el) return false;
    const st = getComputedStyle(el);
    return st.display !== 'none' && st.visibility !== 'hidden' && el.offsetParent !== null;
  };
  const inputs = [...document.querySelectorAll('input')];
  const legalInput = inputs.find((inp) => visible(inp) && (inp.placeholder || '').includes('法人'));
  if (!legalInput) return JSON.stringify({ ok: false, error: 'legal-input-not-found' });
  if ((legalInput.value || '').trim()) {
    return JSON.stringify({ ok: true, already: true, picked: legalInput.value });
  }
  const wrapper = legalInput.closest('.el-select');
  if (!wrapper) return JSON.stringify({ ok: false, error: 'dropdown-not-open' });
  fire(wrapper, 'mousedown');
  fire(wrapper, 'mouseup');
  fire(wrapper, 'click');
  let items = [];
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    items = [...document.querySelectorAll('.el-select-dropdown__item')].filter(visible);
    if (items.length) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!items.length) return JSON.stringify({ ok: false, error: 'dropdown-not-open' });
  const texts = items.map((it) => (it.textContent || '').trim());
  let target = null;
  const want = (legalName || '').trim();
  if (want) target = items.find((it, i) => texts[i] === want);
  if (!target) target = items[0];
  fire(target, 'mousedown');
  fire(target, 'mouseup');
  fire(target, 'click');
  await new Promise((r) => setTimeout(r, 100));
  if ((legalInput.value || '').trim()) {
    return JSON.stringify({ ok: true, picked: legalInput.value, options: texts });
  }
  return JSON.stringify({ ok: false, error: 'option-not-found' });
}'''
