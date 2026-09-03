"""
JS snippet constants: JS_XHR_HOOK (init-script hook installer) + JS_XHR_RECENT
(日志读取 snippet)。

KB-I5 run11 实证引擎缺口①：SUT 前端把 doDclScmNextCheck 的 code:100 拒绝
静默吞掉（无 toast、无 formErrors），引擎侧没有任何「读最近 XHR 响应体」的
动作，无法定位静默闸的拒绝原因。同理，分区保存是否发出 saveOrUpdate 请求、
请求体是否携带关键字段（aplyAmt / primWrntTp 等），此前无实证通道。

方案：注入期 hook XMLHttpRequest.prototype.open/send 与 window.fetch，把最近
20 条请求 {method, url, status, responseBody(截断 2KB), ts} 记到
window.__xhr_log；JS_XHR_RECENT 读取并按 url 关键字过滤返回。

注入时机（read_xhr_log 动作，_observe.py 注册）：
1. 优先 page.add_init_script(JS_XHR_HOOK) —— 只装一次（幂等安装器 +
   installed 标记），此后所有同页导航的请求从第一条起可追溯；
2. 动作每次调用先探测 window.__xhr_log_installed，未装则即时 evaluate
   安装并置 installedNow=true —— 历史请求不可追溯（historyTraced=false，
   提示 agent 需重触发请求后再读）。
"""

# init-script / 即时安装两用的纯 hook 安装器（幂等）。
JS_XHR_HOOK = '''(args) => {
    if (window.__xhr_log_installed) return;
    Object.defineProperty(window, '__xhr_log_installed', { value: true, enumerable: false });
    window.__xhr_log = [];
    var MAX = 20, BODY_LIMIT = 2048;
    var push = function (method, url, status, body) {
        try {
            var rec = {
                method: method || '',
                url: String(url || ''),
                status: status == null ? null : status,
                ts: Date.now(),
                responseBody: body == null ? null : String(body).slice(0, BODY_LIMIT)
            };
            window.__xhr_log.push(rec);
            while (window.__xhr_log.length > MAX) window.__xhr_log.shift();
        } catch (e) { /* never break the page */ }
    };
    // ---- XMLHttpRequest ----
    var XHROpen = XMLHttpRequest.prototype.open;
    var XHRSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
        this.__xhr_meta = { method: method, url: String(url) };
        return XHROpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
        var self = this;
        var meta = self.__xhr_meta || { method: '', url: '' };
        self.addEventListener('loadend', function () {
            var body = null;
            try { body = self.responseType === '' || self.responseType === 'text' ? self.responseText : null; }
            catch (e) { body = null; }
            push(meta.method, meta.url, self.status, body);
        });
        return XHRSend.apply(this, arguments);
    };
    // ---- fetch ----
    if (typeof window.fetch === 'function') {
        var origFetch = window.fetch;
        window.fetch = function () {
            var input = arguments[0];
            var init = arguments[1] || {};
            var url = (typeof input === 'string') ? input
                : (input && input.url) ? input.url : String(input);
            var method = (init && init.method) || (input && input.method) || 'GET';
            return origFetch.apply(this, arguments).then(function (resp) {
                try {
                    resp.clone().text().then(function (t) {
                        push(method, url, resp.status, t);
                    }).catch(function () { push(method, url, resp.status, null); });
                } catch (e) { push(method, url, resp.status, null); }
                return resp;
            }, function (err) {
                push(method, url, 0, 'fetch-error:' + String(err).slice(0, 200));
                throw err;
            });
        };
    }
}'''

# 读取 snippet：前置条件 = JS_XHR_HOOK 已安装（Python 侧保证）。
JS_XHR_RECENT = '''async (args) => {
    const [urlFilter, lastArg, installedNow] = args || [];
    const filter = String(urlFilter || '').trim();
    const last = Math.max(1, Math.min(50, parseInt(lastArg, 10) || 10));
    const all = Array.isArray(window.__xhr_log) ? window.__xhr_log : [];
    const matched = filter
        ? all.filter((r) => (r.url || '').indexOf(filter) !== -1)
        : all.slice();
    return JSON.stringify({
        ok: true,
        installedNow: !!installedNow,
        historyTraced: !installedNow,
        historyHint: installedNow
            ? 'hook 安装于本次调用——历史请求不可追溯，仅此后请求入日志'
            : undefined,
        totalBuffered: all.length,
        matched: matched.length,
        items: matched.slice(-last)
    });
}'''
