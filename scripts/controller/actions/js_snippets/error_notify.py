"""
JS snippet constants: JS_READ_ERROR_NOTIFY.

SUT 展示后端错误的三个 UI 通道（run21 教训：确认类动作失败时错误只出现在
这里，页面无任何提示，引擎若不主动读取就会把失败误判为成功或"静默"）：
  1. 「异常信息」弹窗（天元定制）：标题含"异常信息"，正文含 信息说明/
     全局流水号/系统流水号/服务名/异常栈信息
  2. el-message / el-message-box toast
  3. el-notification

read_error_notify() 动作应在确认类动作（确认/保存/流程提交/出账等）之后
调用：无错误返回 {ok:true, errors:[], toasts:[...], semantic_summary:[]}；
有错误返回 {ok:false, errors:[{text:完整文本, meaning:语义标注}...],
toasts:[...], semantic_summary:[meaning 去重列表]}。meaning 规则：
含「不可重复被引入」→ already-introduced；「请先保存」/「未保存」→
module-unsaved；「请录入」→ required-missing；其他 → unknown。
调用方据此判定真实结果。
"""

JS_READ_ERROR_NOTIFY = '''() => {
    const norm = (s) => String(s == null ? '' : s).replace(/\\s+/g, ' ').trim();
    const visible = (el) => el.offsetParent !== null || el.getClientRects().length > 0;

    const errors = [];
    const toasts = [];

    // 语义标注（meaning）规则：errors 元素为 {text, meaning} 对象
    // - already-introduced : 含「不可重复被引入」（幂等成功信号，主列表已有行即可继续）
    // - module-unsaved     : 含「请先保存」/「未保存」（当前模块未保存）
    // - required-missing   : 含「请录入」（必填项缺失）
    // - unknown            : 其他
    const classify = (t) => {
        if (t.includes('不可重复被引入')) return 'already-introduced';
        if (t.includes('请先保存') || t.includes('未保存')) return 'module-unsaved';
        if (t.includes('请录入')) return 'required-missing';
        return 'unknown';
    };
    const pushErr = (raw) => {
        const text = norm(raw);
        if (!text) return;
        errors.push({ text: text.slice(0, 200), meaning: classify(text) });
    };

    // 1) 「异常信息」弹窗（天元定制错误弹窗）：标题或首行含"异常信息"
    for (const d of document.querySelectorAll('.el-dialog, .el-message-box')) {
        if (!visible(d)) continue;
        const txt = norm(d.textContent);
        if (!txt.includes('异常信息')) continue;
        // 提取关键行：信息说明 / 不可重复 等业务错误文案（去掉栈细节）
        const infoMatch = txt.match(/信息说明[：:]([^全]{0,120}?)(?=全局流水号|系统流水号|服务名|异常栈|$)/);
        const firstLine = txt.split(' ').slice(0, 30).join(' ');
        pushErr(infoMatch ? infoMatch[1] : firstLine.slice(0, 200));
    }

    // 2) el-message toast（success/error/warning）
    for (const m of document.querySelectorAll('.el-message')) {
        if (!visible(m)) continue;
        const t = norm(m.textContent);
        if (t) toasts.push(t.slice(0, 120));
        if (m.className.includes('error') || m.className.includes('warning')) {
            pushErr('toast:' + t.slice(0, 160));
        }
    }

    // 3) el-message-box（含错误图标或确认框）——排除纯确认框
    for (const mb of document.querySelectorAll('.el-message-box')) {
        if (!visible(mb)) continue;
        const title = mb.querySelector('.el-message-box__title');
        const msg = mb.querySelector('.el-message-box__message, .el-message-box__content');
        const tt = norm(title ? title.textContent : '');
        if (tt.includes('异常') || (msg && /失败|错误|不可|请先/.test(msg.textContent))) {
            pushErr('msgbox:' + norm(msg ? msg.textContent : tt).slice(0, 200));
        }
    }

    // 4) el-notification —— 天元异常通知 className="el-notification
    //    exception-message right"（**不含 error 字样**！el-icon-error 在子元素
    //    i 上，run22 用户截图实锤）。三特征判定：exception-message 类 /
    //    title 含「异常信息」/ 子元素含 el-icon-error。
    for (const n of document.querySelectorAll('.el-notification')) {
        if (!visible(n)) continue;
        const t = norm(n.textContent);
        if (t) toasts.push(t.slice(0, 200));
        const title = norm(n.querySelector('.el-notification__title')?.textContent);
        const isErr = n.className.includes('exception-message')
            || n.querySelector('.el-icon-error') !== null
            || title.includes('异常信息');
        if (isErr) {
            const infoMatch = t.match(/信息说明[：:]([^全]{0,150}?)(?=全局流水号|系统流水号|服务名|异常栈|$)/);
            pushErr('notify:' + (infoMatch ? infoMatch[1] : t.slice(0, 160)));
        }
    }

    // 顶层语义汇总：errors 的 meaning 去重列表（如 ['already-introduced']）
    const semantic_summary = [...new Set(errors.map((e) => e.meaning))];

    // 5) __notify_log 兜底：通知 ~3s 消失，observer hook 持久捕获的历史
    //    （含 live 已漏拍的），供确认后追溯。
    let notify_log = window.__notify_log || [];
    if (errors.length === 0) {
        for (const h of notify_log) {
            if (h.isErr && !semantic_summary.includes('notify-history')) {
                // 历史错误已不在 live DOM——只提示存在，不重复入 errors（避免陈旧干扰）
                semantic_summary.push('notify-history');
            }
        }
    }

    if (errors.length) {
        return JSON.stringify({ ok: false, errors, toasts, semantic_summary, notify_log_count: notify_log.length });
    }
    return JSON.stringify({ ok: true, errors: [], toasts, semantic_summary, notify_log: notify_log.slice(-5) });
}'''

# MutationObserver hook：el-notification 生命周期仅 ~3s，动作调用时常已消失。
# 安装后由 observer 持久捕获每条通知文本到 window.__notify_log，read_error_notify
# 同时读 live DOM + __notify_log（最近 20 条），3 秒消失也可追溯。
JS_NOTIFY_HOOK = '''() => {
    if (window.__notify_hook_installed) return 'already';
    window.__notify_log = window.__notify_log || [];
    const norm = (s) => String(s == null ? '' : s).replace(/\\s+/g, ' ').trim();
    const capture = (n) => {
        try {
            const t = norm(n.textContent);
            if (!t) return;
            const isErr = n.className.includes('exception-message')
                || n.querySelector('.el-icon-error') !== null
                || norm(n.querySelector('.el-notification__title')?.textContent).includes('异常信息');
            window.__notify_log.push({
                at: new Date().toISOString().slice(11, 19),
                isErr,
                text: t.slice(0, 300),
            });
            if (window.__notify_log.length > 20) window.__notify_log.shift();
        } catch (e) { /* noop */ }
    };
    const obs = new MutationObserver((muts) => {
        for (const m of muts) {
            m.addedNodes.forEach((n) => {
                if (n.nodeType !== 1) return;
                if (n.classList && n.classList.contains('el-notification')) capture(n);
                n.querySelectorAll && n.querySelectorAll('.el-notification').forEach(capture);
            });
        }
    });
    obs.observe(document.body, { childList: true, subtree: false });
    window.__notify_hook_installed = true;
    return 'installed';
}'''
