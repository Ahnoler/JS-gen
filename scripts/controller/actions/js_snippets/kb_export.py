"""
JS snippet constant: JS_EXPORT_DICTS。

导出天阳前端 localStorage 的全量业务字典缓存（key 前缀 vue_Tansun_dict，
实测单 key `vue_Tansun_dict-<域名>` 约 1MB / 1333 个字典类型，条目
{text, value, dctTp, group, seq}）。返回原始 payload，归一化在 Python 侧
（scripts/kb/normalize.py）完成——JS 只做读取与防御式 JSON.parse。
"""

JS_EXPORT_DICTS = '''() => {
    const KEY_PREFIX = 'vue_Tansun_dict';
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf(KEY_PREFIX) === 0) keys.push(k);
    }
    if (!keys.length) return JSON.stringify({ ok: false, error: 'dict-keys-not-found' });
    const payload = {};
    const skipped = [];
    for (const k of keys) {
        try {
            payload[k] = JSON.parse(localStorage.getItem(k));
        } catch (e) {
            skipped.push(k);
        }
    }
    return JSON.stringify({ ok: true, keys: keys, skipped: skipped, payload: payload });
}'''
