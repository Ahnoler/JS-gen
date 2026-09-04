"""
JS snippet constants: JS_READ_ERROR_NOTIFY.

SUT 展示后端错误的三个 UI 通道（run21 教训：确认类动作失败时错误只出现在
这里，页面无任何提示，引擎若不主动读取就会把失败误判为成功或"静默"）：
  1. 「异常信息」弹窗（天元定制）：标题含"异常信息"，正文含 信息说明/
     全局流水号/系统流水号/服务名/异常栈信息
  2. el-message / el-message-box toast
  3. el-notification

read_error_notify() 动作应在确认类动作（确认/保存/流程提交/出账等）之后
调用：无错误返回 {ok:true, errors:[], toasts:[...]}；有错误返回
{ok:false, errors:[完整文本...], toasts:[...]}，调用方据此判定真实结果。
"""

JS_READ_ERROR_NOTIFY = '''() => {
    const norm = (s) => String(s == null ? '' : s).replace(/\\s+/g, ' ').trim();
    const visible = (el) => el.offsetParent !== null || el.getClientRects().length > 0;

    const errors = [];
    const toasts = [];

    // 1) 「异常信息」弹窗（天元定制错误弹窗）：标题或首行含"异常信息"
    for (const d of document.querySelectorAll('.el-dialog, .el-message-box')) {
        if (!visible(d)) continue;
        const txt = norm(d.textContent);
        if (!txt.includes('异常信息')) continue;
        // 提取关键行：信息说明 / 不可重复 等业务错误文案（去掉栈细节）
        const infoMatch = txt.match(/信息说明[：:]([^全]{0,120}?)(?=全局流水号|系统流水号|服务名|异常栈|$)/);
        const firstLine = txt.split(' ').slice(0, 30).join(' ');
        errors.push(infoMatch ? norm(infoMatch[1]) : firstLine.slice(0, 200));
    }

    // 2) el-message toast（success/error/warning）
    for (const m of document.querySelectorAll('.el-message')) {
        if (!visible(m)) continue;
        const t = norm(m.textContent);
        if (t) toasts.push(t.slice(0, 120));
        if (m.className.includes('error') || m.className.includes('warning')) {
            errors.push('toast:' + t.slice(0, 160));
        }
    }

    // 3) el-message-box（含错误图标或确认框）——排除纯确认框
    for (const mb of document.querySelectorAll('.el-message-box')) {
        if (!visible(mb)) continue;
        const title = mb.querySelector('.el-message-box__title');
        const msg = mb.querySelector('.el-message-box__message, .el-message-box__content');
        const tt = norm(title ? title.textContent : '');
        if (tt.includes('异常') || (msg && /失败|错误|不可|请先/.test(msg.textContent))) {
            errors.push('msgbox:' + norm(msg ? msg.textContent : tt).slice(0, 200));
        }
    }

    // 4) el-notification（error 型）
    for (const n of document.querySelectorAll('.el-notification')) {
        if (!visible(n)) continue;
        if (n.className.includes('error')) {
            errors.push('notify:' + norm(n.textContent).slice(0, 160));
        }
    }

    if (errors.length) {
        return JSON.stringify({ ok: false, errors, toasts });
    }
    return JSON.stringify({ ok: true, errors: [], toasts });
}'''
