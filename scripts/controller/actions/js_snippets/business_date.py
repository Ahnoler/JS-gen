"""
JS snippet constant: JS_READ_BUSINESS_DATE.

天阳信贷系统表单日期字段的默认值以「营业日期」为准，而非系统当天日期。
营业日期（以及数据库日期、租户 ID）由前端写入 localStorage：

    localStorage.businessDate = '2026-8-19'   （注意：月份/日期不带前导零）
    localStorage.databaseDate = '2026-8-19'
    localStorage.tenantId     = '...'

Agent 填写日期类字段前应先调用本片段读取营业日期，以其为基准推导
默认日期值。返回 JSON 字符串，经 page.evaluate 后由调用方解析。
"""

JS_READ_BUSINESS_DATE = '''() => {
    const read = (key) => {
        try {
            const v = window.localStorage.getItem(key);
            return v == null ? '' : String(v);
        } catch (e) {
            return '';
        }
    };
    const businessDate = read('businessDate');
    const databaseDate = read('databaseDate');
    const tenantId = read('tenantId');
    if (!businessDate && !databaseDate && !tenantId) {
        return JSON.stringify({ ok: false, error: 'keys-not-found', businessDate: '', databaseDate: '', tenantId: '' });
    }
    return JSON.stringify({ ok: true, businessDate: businessDate, databaseDate: databaseDate, tenantId: tenantId });
}'''
