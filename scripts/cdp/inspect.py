"""Deep inspect current page form structure via CDP."""
import asyncio, json, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
from playwright.async_api import async_playwright

CDP_PORT = 9242

async def inspect():
    async with async_playwright() as pw:
        browser = await pw.chromium.connect_over_cdp(f'http://127.0.0.1:{CDP_PORT}')
        page = browser.contexts[0].pages[0]

        form_info = await page.evaluate('''() => {
            const result = {formItems: [], tables: [], radios: [], allButtons: []};

            document.querySelectorAll('.el-form-item').forEach((item, i) => {
                const label = item.querySelector('.el-form-item__label')?.textContent?.trim() || '';
                const input = item.querySelector('input:not([type=hidden])');
                const textarea = item.querySelector('textarea');
                const selectTrigger = item.querySelector('.el-select .el-input__inner');
                const inputEl = input || textarea || selectTrigger;
                const disabled = !!(inputEl?.disabled || inputEl?.readOnly || item.querySelector('.el-input.is-disabled'));
                const val = inputEl?.value || '';

                const buttons = [];
                item.querySelectorAll('button, .el-button').forEach(b => {
                    const t = b.textContent.trim();
                    const classes = b.className || '';
                    const isDisabled = b.disabled || b.classList.contains('is-disabled');
                    if (t) buttons.push({text: t, classes: classes.slice(0,80), disabled: isDisabled, tag: b.tagName});
                });

                result.formItems.push({i, label, kind: selectTrigger ? 'select' : (textarea ? 'textarea' : 'input'), val, disabled, hasButtons: buttons.length > 0, buttons});
                if (buttons.length > 0) result.allButtons.push(...buttons.map(b => ({...b, context: 'form-item', label})));
            });

            document.querySelectorAll('.el-table, table').forEach((table, i) => {
                const headers = [];
                table.querySelectorAll('th').forEach(th => headers.push(th.textContent.trim()));
                const rowCount = table.querySelectorAll('tbody tr').length;
                const actionBtns = [];
                table.querySelectorAll('tbody button, tbody .el-button, tbody a.el-button').forEach(b => {
                    const t = b.textContent.trim();
                    if (t) actionBtns.push({text: t, tag: b.tagName});
                });
                if (headers.length > 0 || rowCount > 0) {
                    result.tables.push({i, headers: headers.slice(0,8), rowCount, actionButtons: actionBtns});
                    if (actionBtns.length > 0) result.allButtons.push(...actionBtns.map(b => ({...b, context: 'table'})));
                }
            });

            document.querySelectorAll('.el-radio-group').forEach((group, i) => {
                const options = [];
                group.querySelectorAll('.el-radio').forEach(r => options.push(r.textContent.trim()));
                if (options.length > 0) result.radios.push({i, options});
            });

            document.querySelectorAll('button:not(.el-form-item button):not(table button)').forEach(b => {
                const t = b.textContent.trim();
                if (t && b.offsetParent !== null && !b.disabled) {
                    result.allButtons.push({text: t, context: 'standalone', tag: 'BUTTON'});
                }
            });

            return result;
        }''')

        print('=' * 60)
        print('FORM ITEMS')
        print('=' * 60)
        for item in form_info['formItems']:
            btns = ', '.join([f'"{b["text"]}"' + ('[D]' if b['disabled'] else '') for b in item['buttons']])
            print(f'[{item["i"]}] label="{item["label"]}" kind={item["kind"]} val="{item["val"][:30]}" disabled={item["disabled"]}')
            if btns:
                print(f'    BUTTONS: {btns}')

        print()
        print('=' * 60)
        print('TABLES')
        print('=' * 60)
        for t in form_info['tables']:
            print(f'[{t["i"]}] rows={t["rowCount"]} headers={t["headers"]}')
            if t['actionButtons']:
                print(f'    ACTIONS: {[b["text"] for b in t["actionButtons"]]}')

        print()
        print('=' * 60)
        print('RADIO GROUPS')
        print('=' * 60)
        for r in form_info['radios']:
            print(f'[{r["i"]}] options={r["options"]}')

        print()
        print('=' * 60)
        print(f'ALL VISIBLE BUTTONS ({len(form_info["allButtons"])})')
        print('=' * 60)
        by_ctx = {}
        for b in form_info['allButtons']:
            ctx = b.get('context', '?')
            by_ctx.setdefault(ctx, []).append(b['text'])
        for ctx, texts in by_ctx.items():
            print(f'  [{ctx}]: {texts}')

asyncio.run(inspect())
