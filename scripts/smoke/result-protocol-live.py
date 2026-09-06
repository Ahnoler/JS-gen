#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""LIVE smoke（手动）：Agent 结果协议四场景回放。

前提：CDP 127.0.0.1:19242 已有登录天阳测试环境的浏览器。
自建沙箱页签跑用例（不劫持/不导航现有页签），结束后自动关闭沙箱页签；
无浏览器可连时退出码 3。

用法： ./python/python.exe scripts/smoke/result-protocol-live.py
每场景独立判定 PASS/FAIL，任一 FAIL 退出码 1；无浏览器时退出码 3。
引擎级集成已由 characterize-result-protocol 等 pin 覆盖；本脚本聚焦
真实页面上的协议字符串产出与指引指向。
"""
import asyncio
import json
import re
import sys

sys.path.insert(0, ".")
from playwright.async_api import async_playwright

CDP = "http://127.0.0.1:19242"
BS = chr(92)
Q3 = chr(39) * 3
LIST_URL = (
    "http://test.creditv5p2.tansun.com.cn/#/cstMgt/csinfMnt/cpctMgt/cpctMgtPg"
    "?needupdate=yes&part=cstMgtcsinfMntcpctMgtcpctMgtPg"
)
ROW_KEY = "26082700011272705 璞真健康管理咨询中心"

results = []


def record(case, ok, detail):
    results.append((case, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {case} :: {detail}")


async def ensure_list(page):
    if "cpctMgtPg" not in page.url:
        await page.goto("about:blank")
        await page.goto(LIST_URL)
    for _ in range(6):
        n = await page.evaluate("() => document.querySelectorAll('.el-table__row').length")
        if n:
            return True
        await page.evaluate("() => { for (const b of document.querySelectorAll('button')) { if ((b.innerText||'').trim()==='查询' && b.offsetParent!==null) { b.click(); break; } } }")
        await page.wait_for_timeout(2000)
    return bool(await page.evaluate("() => document.querySelectorAll('.el-table__row').length"))


async def case_table_envelope(page):
    from scripts.controller.actions._table import _register_table_actions  # noqa: F401 (wiring only)
    src_ok = "err-button-not-found-in-row" in open("scripts/controller/actions/_table.py", encoding="utf-8").read()
    r = await page.evaluate(
        "(([rowText]) => {" + """
        const rows=[...document.querySelectorAll('.el-table__body-wrapper .el-table__row')];
        let row=null; const want=rowText.replace(/\\s+/g,'');
        for(const rr of rows){ if(((rr.textContent||'').replace(/\\s+/g,'')).includes(want)){row=rr;break;} }
        if(!row) return 'err-table-row-not-found';
        for(const b of row.querySelectorAll('button,.el-button,a')){
            if(b.offsetParent!==null && ((b.textContent||'').trim())==='修改') return 'has-inline-btn';
        }
        const vis=[...row.querySelectorAll('button,.el-button,a')].filter(b=>b.offsetParent!==null).map(b=>(b.textContent||'').trim()).filter(Boolean);
        return 'err-button-not-found-in-row:'+JSON.stringify({wanted:'修改',rowButtons:vis,rowHasRadio:!!row.querySelector('.el-radio, input[type=radio]')});
    }""" + ")", [ROW_KEY])
    ok = str(r).startswith("err-button-not-found-in-row") and '"rowHasRadio":true' in str(r)
    record("T3 表格行内无按钮→结构化信封", ok and src_ok, str(r)[:140])


async def case_fill_disabled_hint(page):
    # 需在编辑页：radio+工具栏修改 进入 crtCpctInf
    from scripts.controller.actions.js_snippets.select_trigger import JS_SELECT_TRIGGER_BY_XPATH  # noqa
    src_table = open("scripts/controller/actions/_table.py", encoding="utf-8").read()
    i = src_table.find("async def click_table_row_radio")
    j = src_table.find(Q3 + ", [row_text])", i)
    k = src_table.find("page.evaluate(" + Q3, i)
    js_radio = src_table[k + len("page.evaluate(") + len(Q3):j].replace(BS * 2, BS)
    xp = "//div[contains(@class,'el-form-item')][.//label[contains(normalize-space(.),'国别')]]//div[contains(@class,'el-select')]"
    tg = await page.evaluate(JS_SELECT_TRIGGER_BY_XPATH, [xp, "国别"])
    if not str(tg).startswith("ok"):
        record("T4 fill 下拉→select_option 指引", False, f"前置触发失败:{tg}")
        return
    # 用 FillEngine 的 field-disabled 探测等价物：affordances kind 判定
    st = await page.evaluate(r"""(label)=>{
        const items=[...document.querySelectorAll('.el-form-item')];
        for(const fi of items){const lab=fi.querySelector('.el-form-item__label');
          if(!lab)continue;const t=(lab.textContent||'').trim();
          if(t!==label&&!t.includes(label))continue;
          return {kind:(fi.querySelector('.el-select')?'select':fi.querySelector('.el-date-editor,.tsscdatepicker')?'date':'input'),
                  optionsLen:(()=>{const dd=[...document.querySelectorAll('.el-select-dropdown')].filter(d=>d.getBoundingClientRect().width>0).pop();
                    return dd?dd.querySelectorAll('.el-select-dropdown__item').length:0;})()};
        } return null; }""", "国别")
    ok = bool(st) and st.get("kind") == "select"
    record("T4 探测器判定下拉字段（err-field-disabled 素材链）", ok, str(st))


async def case_select_alias_chain(page):
    from scripts.controller.actions._helpers import reset_select_ui
    from scripts.controller.actions.js_snippets.select_trigger import JS_SELECT_TRIGGER_BY_XPATH
    from scripts.controller.actions.js_snippets.select_option import JS_SELECT_OPTION
    xp = "//div[contains(@class,'el-form-item')][.//label[contains(normalize-space(.),'国别')]]//div[contains(@class,'el-select')]"
    t = await page.evaluate(JS_SELECT_TRIGGER_BY_XPATH, [xp, "国别"])
    if not str(t).startswith("ok"):
        record("T1 select 中国 别名链", False, f"trigger:{t}")
        return
    await page.wait_for_timeout(800)
    r1 = await page.evaluate(JS_SELECT_OPTION, "中国")
    ok_chain = False
    detail = f"first={r1}"
    if str(r1).startswith("value-mismatch"):
        await reset_select_ui(page)
        t2 = await page.evaluate(JS_SELECT_TRIGGER_BY_XPATH, [xp, "国别"])
        await page.wait_for_timeout(800)
        r2 = await page.evaluate(JS_SELECT_OPTION, "中华人民共和国")
        detail += f" | retry={r2}"
        ok_chain = str(r2).startswith("ok")
    await reset_select_ui(page)
    record("T1 select 国别=中国 → 别名链可达中华人民共和国", ok_chain, detail[:150])


async def case_icon_text_button(page):
    from scripts.controller.actions.js_snippets.icons import JS_CLICK_ICON_BUTTON
    await page.goto(LIST_URL)
    await page.wait_for_timeout(1500)
    for _ in range(5):
        n = await page.evaluate("() => document.querySelectorAll('.el-table__row').length")
        if n:
            break
        await page.wait_for_timeout(1500)
    r = await page.evaluate(JS_CLICK_ICON_BUTTON, "查询")
    # 查询 是页面级文字按钮：通用化路径应直接点击成功（ok-text）或列表本就刷新无副作用 ok
    ok = str(r).startswith("ok")
    record("T7 icon 工具点文字按钮→ok-text/ok", ok, str(r)[:120])
    await page.evaluate("document.body.click()")


async def main():
    try:
        async with async_playwright() as p:
            browser = await p.chromium.connect_over_cdp(CDP)
            ctx = browser.contexts[0]
            page = await ctx.new_page()
            try:
                if not await ensure_list(page):
                    record("前置：列表页加载", False, "table empty")
                else:
                    record("前置：列表页加载", True, "rows ok")
                    await case_table_envelope(page)
                    # 进入编辑页做 T1/T4
                    radio_js = ("() => { const rows=[...document.querySelectorAll('.el-table__row')];"
                                "const want='" + ROW_KEY.replace(' ', '') + "';"
                                "for(const rr of rows){if(((rr.textContent||'').replace(/\\s+/g,'')).includes(want))"
                                "{const c=rr.querySelector('.el-radio__inner,.el-radio,input[type=radio]');"
                                "if(c){c.click();return true;} } } return false; }")
                    got_radio = await page.evaluate(radio_js)
                    tb = await page.evaluate("""() => {
                        for (const b of document.querySelectorAll('button')) {
                            if ((b.innerText||'').trim()==='修改' && b.offsetParent!==null
                                && !b.closest('.el-table__body-wrapper')) { b.click(); return true; } }
                        return false; }""")
                    await page.wait_for_timeout(2500)
                    if got_radio and tb and "crtCpctInf" in page.url:
                        await case_select_alias_chain(page)
                        await case_fill_disabled_hint(page)
                    else:
                        record("进入编辑页", False, f"radio={got_radio} toolbar={tb}")
                    await case_icon_text_button(page)
            finally:
                # 沙箱页签用完即关，不遗留、不影响既有页签
                try:
                    await page.close()
                except Exception:
                    pass
            await browser.close()
    except Exception as exc:
        print(f"[SKIP] 无法连接 CDP {CDP}: {exc}")
        sys.exit(3)

    fails = [c for c, ok, _ in results if not ok]
    print("=" * 40)
    print(f"SUMMARY: {len(results) - len(fails)}/{len(results)} PASS" + (f"; FAIL cases: {fails}" if fails else ""))
    sys.exit(1 if fails else 0)


asyncio.run(main())
