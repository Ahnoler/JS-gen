"""
JS snippet constants: JS_LIST_TODO_CARDS, JS_WF_SUBMIT_GUARD.

天阳信贷系统实测 DOM 依据（2026-08-31）：

- 待办任务页 `#/portal/wfPendTask` 以卡片呈现任务：卡片容器 class 含
  `todo-item`，动作元素 class 为 `todo-item-action` / `todo-item-actions`
  （动作元素不能当卡片）。卡片 innerText 实测样例：
  【权限申请】退回_客户经理发起 处理 转交 流程跟踪 展开 业务主键：
  PMS20260723036387 上一节点处理人： 张某某丨网点负责人审核 发起人：
  黄某某 (701994) 审批中
- 工作流向导审批页 `#/cstMgt/workflow/detail?bsnPk=…` 末步：「流程操作」
  为 el-select（选项随节点角色变化，发起节点只有「下一步」），「意见详情」
  为 textarea（0/500），按钮组 上一步/返回/流程提交/流程撤销/流程轨迹，
  下方为审批历史 el-table（列含 节点名称/处理时间/处理人/处理状态 等）。
  全局另有 4 个隐藏弹窗常驻 DOM（修改密码/营业日期/智能机器人/天元配置），
  一切读取必须只看可见元素（offsetParent / getClientRects 过滤）。

返回 JSON 形状：

- JS_LIST_TODO_CARDS() -> '{"ok":true,"count":n,"cards":[{"title","bizPk",
  "status","actions":[...]}]}'；无卡片时 count=0、cards=[]（空态合法）。
- JS_WF_SUBMIT_GUARD() -> '{"ok":true,"submit":{...},"undo":{...},
  "opLabel","opValue","opOptions":[...],"opinionLen","opinionMax",
  "historyRows","lastHistoryNode"}'；页面不可辨识时
  '{"ok":false,"error":"wf-page-not-found"}'。

两个片段均为零参数箭头函数，只读元信息、绝不点击任何按钮/下拉；
返回 JSON 字符串。
"""

JS_LIST_TODO_CARDS = '''() => {
    const norm = (s) => String(s == null ? '' : s).replace(/\\s+/g, ' ').trim();
    const isVisible = (el) => {
        try { return el.getClientRects().length > 0; } catch (e) { return false; }
    };
    const isActionEl = (el) => {
        const cls = String(el.className || '');
        return cls.indexOf('todo-item-action') !== -1;
    };
    const all = [...document.querySelectorAll('[class*="todo-item"]')]
        .filter((el) => !isActionEl(el))
        .filter(isVisible)
        .filter((el) => norm(el.innerText || el.textContent).indexOf('业务主键') !== -1);
    if (all.length === 0) {
        return JSON.stringify({ ok: true, count: 0, cards: [] });
    }
    // Nested hits (parent & child both carry a todo-item class): keep the
    // outermost element with the longest innerText only.
    const kept = all.filter((el) => !all.some(
        (other) => other !== el && other.contains(el)
    ));
    const cards = kept.map((el) => {
        const text = norm(el.innerText || el.textContent);
        let title = '';
        const mTitle = text.match(/【[^】]*】/);
        if (mTitle) {
            const idx = text.indexOf(mTitle[0]);
            const tail = text.slice(idx + mTitle[0].length);
            const stop = tail.search(/(?:处理|转交|流程跟踪|展开)|\\s{2,}/);
            title = (mTitle[0] + (stop === -1 ? tail : tail.slice(0, stop))).trim();
        }
        const mPk = text.match(/业务主键[：:]\\s*([A-Za-z0-9_-]+)/);
        const bizPk = mPk ? mPk[1] : '';
        const statusWords = ['审批中', '已完成', '已办', '草稿', '退回', '审批通过', '驳回', '撤销'];
        let status = '';
        let statusIdx = -1;
        for (const w of statusWords) {
            let from = 0;
            for (;;) {
                const i = text.indexOf(w, from);
                if (i === -1) break;
                if (i > statusIdx) { statusIdx = i; status = w; }
                from = i + w.length;
            }
        }
        const actions = [...el.querySelectorAll('.todo-item-action')]
            .filter(isVisible)
            .map((a) => norm(a.innerText || a.textContent))
            .filter((t) => t.length > 0);
        return { title: title, bizPk: bizPk, status: status, actions: actions };
    });
    return JSON.stringify({ ok: true, count: cards.length, cards: cards });
}'''

JS_WF_SUBMIT_GUARD = '''() => {
    const norm = (s) => String(s == null ? '' : s).replace(/\\s+/g, ' ').trim();
    const isVisible = (el) => {
        try {
            if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false;
            return el.getClientRects().length > 0;
        } catch (e) { return false; }
    };
    const findButton = (token) => {
        for (const btn of document.querySelectorAll('button')) {
            if (!isVisible(btn)) continue;
            const t = norm(btn.innerText || btn.textContent);
            if (!t || t.indexOf('流程轨迹') !== -1 || t.indexOf('上一步') !== -1 || t.indexOf('返回') !== -1) continue;
            if (t.indexOf(token) !== -1) {
                return { text: t, visible: true, disabled: !!btn.disabled };
            }
        }
        return null;
    };
    const findFormItem = (labelToken) => {
        for (const item of document.querySelectorAll('.el-form-item')) {
            if (!isVisible(item)) continue;
            const lbl = item.querySelector('.el-form-item__label');
            if (!lbl || norm(lbl.textContent).indexOf(labelToken) === -1) continue;
            return item;
        }
        return null;
    };
    const submit = findButton('提交');
    const undo = findButton('撤销');
    const opItem = findFormItem('流程操作');
    if (!submit && !opItem) {
        return JSON.stringify({ ok: false, error: 'wf-page-not-found' });
    }
    let opLabel = null;
    let opValue = null;
    if (opItem) {
        const lbl = opItem.querySelector('.el-form-item__label');
        opLabel = norm(lbl.textContent).replace(/[：:*]+$/, '');
        const input = opItem.querySelector('input:not([type="hidden"])');
        opValue = input ? norm(input.value) : null;
    }
    // Only already-rendered visible dropdown items; do NOT open the dropdown.
    const opOptions = [...document.querySelectorAll('.el-select-dropdown__item')]
        .filter(isVisible)
        .map((o) => norm(o.innerText || o.textContent))
        .filter((t) => t.length > 0);
    let opinionLen = null;
    let opinionMax = null;
    const opinionItem = findFormItem('意见详情');
    if (opinionItem) {
        const ta = opinionItem.querySelector('textarea');
        if (ta) {
            opinionLen = norm(ta.value).length;
            const ml = ta.getAttribute('maxlength');
            opinionMax = (ml != null && ml !== '' && !isNaN(Number(ml))) ? Number(ml) : null;
        }
    }
    let historyRows = 0;
    let lastHistoryNode = '';
    for (const table of document.querySelectorAll('.el-table')) {
        if (!isVisible(table)) continue;
        const rows = [...table.querySelectorAll('.el-table__body tbody tr')]
            .filter(isVisible);
        if (rows.length > 0) {
            historyRows = rows.length;
            const firstCell = rows[rows.length - 1].querySelector('td');
            lastHistoryNode = firstCell ? norm(firstCell.innerText || firstCell.textContent).slice(0, 20) : '';
        }
    }
    return JSON.stringify({
        ok: true,
        submit: submit,
        undo: undo,
        opLabel: opLabel,
        opValue: opValue,
        opOptions: opOptions,
        opinionLen: opinionLen,
        opinionMax: opinionMax,
        historyRows: historyRows,
        lastHistoryNode: lastHistoryNode
    });
}'''
