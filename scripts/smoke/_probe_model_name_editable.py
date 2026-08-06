# -*- coding: utf-8 -*-
"""Probe 模型名称 editable using project JS_FIELD_DISABLED / isFormItemDisabled."""
import asyncio
import json
from pathlib import Path

from playwright.async_api import async_playwright

OUT = Path(__file__).resolve().parents[2] / "tmp" / "cdp-model-name-editable.json"

JS = r"""
(labelWant) => {
  const isDisabled = (inputEl, trigger, item) => {
    if (trigger && trigger.disabled) return true;
    if (inputEl && inputEl.disabled) return true;
    const root = item
      || (inputEl && inputEl.closest && inputEl.closest('.el-form-item'))
      || (trigger && trigger.closest && trigger.closest('.el-form-item'));
    if (!root) return false;
    const content = root.querySelector('.el-form-item__content') || root;
    if (content.querySelector(
      '.el-input.is-disabled, .el-textarea.is-disabled, .el-select.is-disabled,'
      + ' .el-radio-group.is-disabled, .el-checkbox-group.is-disabled,'
      + ' .el-cascader.is-disabled, .el-date-editor.is-disabled,'
      + ' .el-radio.is-disabled, .el-checkbox.is-disabled'
    )) return true;
    const hosts = content.querySelectorAll(
      '.my-popover, .tree-popover, [class*="tssc"], .el-select, .el-input,'
      + ' .el-cascader, .el-date-editor, .el-radio-group, .el-checkbox-group'
    );
    for (const host of hosts) {
      let v = host.__vue__;
      let depth = 0;
      while (v && depth < 10) {
        const n = (v.$options && v.$options.name) ? String(v.$options.name) : '';
        if (
          n.includes('TsscMultiTree') || n.includes('TsscInput') || n.includes('TsscSelect')
          || n.includes('TsscDate') || n === 'ElSelect' || n === 'ElInput'
          || n === 'ElCascader' || n === 'ElDatePicker' || n === 'ElRadioGroup'
          || n === 'ElCheckboxGroup'
        ) {
          if (v.disabled === true || (v.$props && v.$props.disabled === true)) return true;
        }
        v = v.$parent;
        depth++;
      }
    }
    return false;
  };

  const visible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).display !== 'none';
  };
  const getContainer = () => {
    for (const d of document.querySelectorAll('.el-dialog')) if (visible(d)) return d;
    for (const d of document.querySelectorAll('.el-drawer')) if (visible(d)) return d;
    return document;
  };

  const container = getContainer();
  const scopeTitle = (
    (container.querySelector && (container.querySelector('.el-drawer__title, .el-dialog__title') || {}).textContent) || ''
  ).trim();

  const hits = [];
  for (const item of container.querySelectorAll('.el-form-item')) {
    const labRaw = (item.querySelector('.el-form-item__label, label') || {}).textContent || '';
    const lab = labRaw.replace(/\s+/g, '').replace(/\*/g, '');
    if (!lab.includes(labelWant) && !labRaw.includes(labelWant)) continue;

    const input = item.querySelector('input:not([type="hidden"])') || item.querySelector('textarea');
    const trigger = item.querySelector('.el-select .el-input__inner');
    const select = item.querySelector('.el-select');
    const kind = select ? 'el-select'
      : (item.querySelector('.el-date-editor, .tsscdatepicker') ? 'date'
      : (item.querySelector('textarea') ? 'textarea' : 'input'));

    const disabled = isDisabled(input, trigger || input, item);
    const readOnlyBlocked = !!(
      input && input.readOnly
      && !item.querySelector('.el-date-editor, .tsscdatepicker, .el-select, .my-popover, .tree-popover, .el-cascader')
    );

    const vueFlags = [];
    const content = item.querySelector('.el-form-item__content') || item;
    for (const host of content.querySelectorAll('.el-select, .el-input, [class*="tssc"]')) {
      let v = host.__vue__;
      let depth = 0;
      while (v && depth < 8) {
        const n = (v.$options && v.$options.name) ? String(v.$options.name) : '';
        if (n) {
          vueFlags.push({
            name: n,
            disabled: v.disabled === true,
            propsDisabled: !!(v.$props && v.$props.disabled === true),
          });
        }
        v = v.$parent;
        depth++;
      }
    }

    hits.push({
      label: labRaw.trim(),
      kind,
      currentValue: (trigger || input) ? (trigger || input).value : null,
      placeholder: (trigger || input) ? (trigger || input).placeholder : null,
      inputDisabledAttr: !!(input && input.disabled),
      triggerDisabledAttr: !!(trigger && trigger.disabled),
      inputReadOnly: !!(input && input.readOnly),
      hasIsDisabledClass: !!content.querySelector('.is-disabled'),
      projectIsDisabled: disabled,
      readOnlyBlockedForFill: readOnlyBlocked,
      editableByProject: !disabled && !readOnlyBlocked,
      verdict: (!disabled && !readOnlyBlocked) ? 'editable' : 'not-editable',
      projectReturnIfWrite: disabled
        ? (select ? 'select-disabled' : 'field-disabled')
        : (readOnlyBlocked ? 'field-disabled' : 'would-allow-write'),
      vueFlags: vueFlags.slice(0, 12),
      classes: item.className,
    });
  }

  return {
    url: location.href,
    scopeTitle,
    labelWant,
    hitCount: hits.length,
    hits,
  };
}
"""


async def main() -> None:
    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp("http://127.0.0.1:9242")
        page = None
        for ctx in browser.contexts:
            for pg in ctx.pages:
                u = pg.url or ""
                if "cpctRtg" in u or "rtg" in u or "credit" in u:
                    page = pg
                    break
            if page:
                break
        if not page:
            page = browser.contexts[0].pages[0]
        data = await page.evaluate(JS, "模型名称")
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(data, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
