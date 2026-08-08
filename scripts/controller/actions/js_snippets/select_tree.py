"""
JS snippet constants: JS_CLICK_RADIO, JS_SELECT_TREE_OPTION (extracted from _js_snippets.py).
Re-exported by scripts/actions/_js_snippets.py for backward compat.
"""
from .base import JS_FIELD_DISABLED
from .container import JS_GET_CONTAINER

JS_CLICK_RADIO = '''([label, option]) => {
    const isDisabled = ''' + JS_FIELD_DISABLED + ''';
    const container = ''' + JS_GET_CONTAINER + ''';
    const items = container.querySelectorAll('.el-form-item');
    for (const item of items) {
        const lbl = item.querySelector('.el-form-item__label')?.textContent?.trim() || '';
        if (!lbl.includes(label)) continue;
        item.scrollIntoView({ block: 'center', behavior: 'instant' });
        const input = item.querySelector('input:not([type="hidden"])');
        if (isDisabled(input, null, item)) return 'disabled';
        const radios = item.querySelectorAll('.el-radio');
        for (const radio of radios) {
            if (radio.classList.contains('is-disabled')) continue;
            if (radio.textContent.trim() === option && radio.offsetParent !== null) {
                radio.click(); return 'ok';
            }
        }
        return 'option-not-found';
    }
    return 'label-not-found';
}'''

# ── Tree select (custom TsscMultiTree component) ──
#
# 探索过程 (2026-06-30, Edge CDP 实测):
#   1. 该组件不是 Element UI 标准组件 — 是自定义的 el-popover + el-tree 组合。
#      DOM 选择器: .el-form-item → input(trigger) → .tree-popover > .el-tree
#   2. __vue__ 链: ElTree → ElPopover → ElTooltip → TsscMultiTree (关键层)
#      TsscMultiTree 持有 treeData (1974 个扁平节点) 和 data (22 个根节点)
#   3. 踩过的坑:
#      - span.click() 触发不了选中 → Vue 事件绑定在 TsscMultiTree 层
#      - el-tree.setCurrentKey() 选中了但 input 不更新 → 回调在 TsscMultiTree
#      - el-tree.setChecked() 同样无效 → 需要 TsscMultiTree.$emit('input', code)
#      - handleHideClick() 关闭弹窗 (可选)
#   4. 正确的 API: vm.$emit('input', code) → 组件自动 code→label 并更新 input 值
#   5. 数据查找: treeData 是扁平数组 [{label, value, children?}]; data 是树结构
#   6. 注意: 必须先用 input.click() 打开 popover 才能访问 .el-tree DOM
#
# 未来类似 action 的创建参考:
#   - 先通过 __vue__ 链找到业务组件 (含 data/props/methods 的那个)
#   - 测试 Vue 各种 API (setValue/handleSelect/onNodeClick/$emit) 找到正确入口
#   - 不要假设标准 Element UI API 有效 (即使 DOM 类名相同)


JS_SELECT_TREE_OPTION = '''async ([label, option]) => {
    const isDisabled = ''' + JS_FIELD_DISABLED + ''';
    // Open the popover first so tree DOM is rendered
    const container = ''' + JS_GET_CONTAINER + ''';
    const items = container.querySelectorAll('.el-form-item');
    let fieldItem = null;
    for (const item of items) {
        const l = item.querySelector('.el-form-item__label')?.textContent?.trim() || '';
        if (l === label || l.includes(label)) { fieldItem = item; break; }
    }
    if (!fieldItem) return 'label-not-found';
    fieldItem.scrollIntoView({ block: 'center', behavior: 'instant' });
    const input = fieldItem.querySelector('input');
    if (!input) return 'no-input';
    if (isDisabled(input, null, fieldItem)) return 'disabled';
    // Read value from any non-empty input in the form item
    const readDisplayValue = () => {
        for (const inp of fieldItem.querySelectorAll('input:not([type="hidden"])')) {
            if (inp.value && inp.value.trim()) return inp.value.trim();
        }
        return '';
    };
    // Open popover
    input.click();
    await new Promise(r => setTimeout(r, 200));
    // Find TsscMultiTree — NEVER use bare document.querySelector('.el-tree'):
    // product/category sidebars also use .el-tree and are not this component.
    const isTssc = (v) => !!(v && v.$options && v.$options.name
        && String(v.$options.name).includes('TsscMultiTree'));
    const walkVueForTssc = (start) => {
        let v = start;
        while (v) {
            if (isTssc(v)) return v;
            v = v.$parent;
        }
        return null;
    };
    const tryFind = () => {
        const hosts = fieldItem.querySelectorAll(
            '.my-popover, .tree-popover, [class*="tssc"], .el-select, input'
        );
        for (const host of [fieldItem, ...hosts]) {
            if (!host || !host.__vue__) continue;
            const found = walkVueForTssc(host.__vue__);
            if (found) return found;
        }
        const popTrees = document.querySelectorAll(
            '.tree-popover .el-tree, .el-popper[aria-hidden="false"] .el-tree,'
            + ' .el-popover[aria-hidden="false"] .el-tree'
        );
        for (const tree of popTrees) {
            if (!tree.__vue__) continue;
            const found = walkVueForTssc(tree.__vue__);
            if (found) return found;
        }
        for (const pop of document.querySelectorAll('.tree-popover, .el-popover, .el-popper')) {
            if (pop.getAttribute('aria-hidden') === 'true') continue;
            const st = pop.getAttribute('style') || '';
            if (/display:\\s*none/i.test(st)) continue;
            const tree = pop.querySelector('.el-tree');
            if (!tree || !tree.__vue__) continue;
            const found = walkVueForTssc(tree.__vue__);
            if (found) return found;
        }
        return null;
    };
    let vm = tryFind();
    if (!vm) {
        return 'no-tree-component | Not TsscMultiTree (ignore page sidebar .el-tree).'
            + ' Do NOT retry select_tree_option.'
            + ' Use fill_form_field(label, concreteValue) or select_option if el-select.';
    }
    if (vm.disabled === true || (vm.$props && vm.$props.disabled === true)) return 'disabled';

    // ═══════════════════════════════════════════════════════════════════
    // P0: Exact match — resolve to a leaf node code.
    //
    // data[] is hierarchical: { label, id, children? }.  Leaf = no children.
    // treeData[] is flat:     { name, id, pId } (no children, no label).
    //
    // Match by display text (label / name) OR by code (id).
    // ═══════════════════════════════════════════════════════════════════
    const isLeafNode = (node) => !node.children || node.children.length === 0;
    const dfsFirstLeaf = (nodes) => {
        for (const n of nodes) {
            if (isLeafNode(n)) return n;
            if (n.children) {
                const r = dfsFirstLeaf(n.children);
                if (r) return r;
            }
        }
        return null;
    };
    // option "first"/empty → skip keyword search (would search literal "first")
    const wantFirst = !option || String(option).trim().toLowerCase() === 'first';
    if (wantFirst) {
        const leaf = dfsFirstLeaf(vm.data || []);
        let codeFirst = leaf ? leaf.id : null;
        let labelFirst = leaf ? (leaf.label || leaf.name || leaf.id) : '';
        if (!codeFirst && (vm.treeData || []).length) {
            const flat0 = vm.treeData[0];
            codeFirst = flat0 && (flat0.id != null ? flat0.id : flat0.value);
            labelFirst = (flat0 && (flat0.name || flat0.label)) || codeFirst;
        }
        if (codeFirst != null && codeFirst !== '') {
            vm.$emit('input', codeFirst);
            await new Promise(r => setTimeout(r, 150));
            const verifyVal = readDisplayValue();
            setTimeout(() => {
                if (typeof vm.handleHideClick === 'function') vm.handleHideClick();
            }, 100);
            if (verifyVal) {
                return 'ok-fallback:first → ' + verifyVal + ' (' + codeFirst + ')';
            }
            return 'fail: first-leaf emit did not update input for code=' + codeFirst;
        }
        return 'no-leaf-for-first';
    }
    const nodeMatches = (n) => (n.label || n.name || '') === option || n.id === option;
    const walkForLeaf = (nodes) => {
        for (const n of nodes) {
            if (nodeMatches(n)) {
                if (isLeafNode(n)) return n.id;
                const leaf = dfsFirstLeaf(n.children || []);
                if (leaf) return leaf.id;
                return null;
            }
            if (n.children) { const r = walkForLeaf(n.children); if (r) return r; }
        }
        return null;
    };
    // Try hierarchical data first (proper tree), then flat treeData
    code = walkForLeaf(vm.data || []);
    if (!code) {
        const flat = vm.treeData || [];
        for (const n of flat) {
            if ((n.name || '') === option || n.id === option) { code = n.id; break; }
        }
    }
    if (code) {
        vm.$emit('input', code);
        // Verify the selection took effect — the component may reject invalid codes
        await new Promise(r => setTimeout(r, 150));
        const verifyVal = readDisplayValue();
        if (!verifyVal) {
            return 'fail: emit did not update input for code=' + code;
        }
        setTimeout(() => {
            if (typeof vm.handleHideClick === 'function') vm.handleHideClick();
        }, 100);
        return 'ok:' + option + ' (' + code + ')';
    }

    // ═══════════════════════════════════════════════════════════════════
    // P1: UI keyword search — Pass 1: click first visible leaf.
    // Pass 2: if only non-leaf visible → expand it → DFS first leaf child.
    // Supports .tree-popover (old) and .el-popover (custom wrappers).
    // ═══════════════════════════════════════════════════════════════════
    let popover = document.querySelector('.tree-popover');
    if (!popover || popover.offsetParent === null) {
        const allPopovers = document.querySelectorAll('.el-popover');
        for (const p of allPopovers) {
            if (p.offsetParent !== null) { popover = p; break; }
        }
    }
    if (popover) {
        // For custom search-input wrappers: use field's own input (already focused)
        // For standard tree-popover: find input/button inside popover
        const searchInput = popover.querySelector('.search-input input') || popover.querySelector('input');
        const searchBtn = popover.querySelector('.search-input button') || popover.querySelector('button');
        if (searchInput && searchBtn) {
            const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
            s.call(searchInput, option || '科技');
            searchInput.dispatchEvent(new InputEvent('input', { bubbles: true }));
            setTimeout(() => {
                searchBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                searchBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                searchBtn.click();
                searchBtn.dispatchEvent(new Event('click', { bubbles: true }));
            }, 200);
            const result = await new Promise(resolve => {
                // Poll for filtered results — the tree may take time to re-render
                let elapsed = 0;
                const poll = () => {
                    const allNodes = document.querySelectorAll('.el-tree-node');
                    const hidden = document.querySelectorAll('.el-tree-node.is-hidden').length;
                    const visible = allNodes.length - hidden;
                    // Tree is filtered when hidden nodes appear (search narrowed results)
                    if (visible < allNodes.length || elapsed >= 2000) {
                        const nodes = document.querySelectorAll('.el-tree-node:not(.is-hidden)');
                        // Pass 1: look for a visible leaf node
                        for (const node of nodes) {
                            const icon = node.querySelector('.el-tree-node__expand-icon');
                            const children = node.querySelector('.el-tree-node__children');
                            const isLeaf = !icon || icon.classList.contains('is-leaf') || !children || children.querySelectorAll('.el-tree-node').length === 0;
                            if (isLeaf) {
                                const lbl = node.querySelector('.el-tree-node__label');
                                const labelText = (lbl?.textContent || node.textContent || '').trim();
                                if (lbl) lbl.click(); else node.click();
                                const nodeVm = node.__vue__;
                                if (nodeVm && vm && typeof vm.$emit === 'function') {
                                    const nodeData = nodeVm.data || nodeVm.$data || {};
                                    const code = nodeData.value || nodeData.id || nodeData.code || '';
                                    if (code) vm.$emit('input', code);
                                }
                                resolve(labelText);
                                return;
                            }
                        }
                        // Pass 2: no leaf visible — expand first non-leaf, poll for leaf children
                        for (const node of nodes) {
                            const icon = node.querySelector('.el-tree-node__expand-icon');
                            if (icon && !icon.classList.contains('is-leaf')) {
                                icon.click();
                                setTimeout(() => {
                                    const children = node.querySelector('.el-tree-node__children');
                                    const leafKids = children ? children.querySelectorAll('.el-tree-node:not(.is-hidden)') : [];
                                    for (const child of leafKids) {
                                        const cIcon = child.querySelector('.el-tree-node__expand-icon');
                                        const cChildren = child.querySelector('.el-tree-node__children');
                                        const cIsLeaf = !cIcon || cIcon.classList.contains('is-leaf') || !cChildren || cChildren.querySelectorAll('.el-tree-node').length === 0;
                                        if (cIsLeaf) {
                                            const lbl = child.querySelector('.el-tree-node__label');
                                            const labelText = (lbl?.textContent || child.textContent || '').trim();
                                            if (lbl) lbl.click(); else child.click();
                                            const nodeVm = child.__vue__;
                                            if (nodeVm && vm && typeof vm.$emit === 'function') {
                                                const nodeData = nodeVm.data || nodeVm.$data || {};
                                                const code = nodeData.value || nodeData.id || nodeData.code || '';
                                                if (code) vm.$emit('input', code);
                                            }
                                            resolve(labelText);
                                            return;
                                        }
                                    }
                                    resolve(null);
                                }, 300);
                                return; // async — poll callback will resolve
                            }
                        }
                        resolve(null);
                    } else {
                        elapsed += 200;
                        setTimeout(poll, 200);
                    }
                };
                setTimeout(poll, 300);
            });
            if (result) {
                await new Promise(r => setTimeout(r, 150));
                const verifyVal = readDisplayValue();
                setTimeout(() => {
                    if (typeof vm.handleHideClick === 'function') vm.handleHideClick();
                }, 100);
                if (!verifyVal) {
                    return 'fail: search-click did not update input, clicked=' + result;
                }
                return 'ok-search:' + result;
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // P2: Last resort — pick the first leaf node from the full tree data.
    // ═══════════════════════════════════════════════════════════════════
    const data = vm.data || [];
    const walkLeaf = (ns) => {
        for (const n of ns) {
            if (!n.children || n.children.length === 0) return n;
            const r = walkLeaf(n.children);
            if (r) return r;
        }
        return null;
    };
    const first = walkLeaf(data);
    if (first) {
        code = first.value || first.id;
        option = first.label || first.value || first.id;
        vm.$emit('input', code);
        await new Promise(r => setTimeout(r, 150));
        const verifyVal = readDisplayValue();
        setTimeout(() => {
            if (typeof vm.handleHideClick === 'function') vm.handleHideClick();
        }, 100);
        if (!verifyVal) {
            return 'fail: fallback emit did not update input for code=' + code;
        }
        return 'ok-fallback:' + option + ' (' + code + ')';
    }
    return 'option-not-found';
}'''

# ── Shared field helpers (referenced by JS_SCAN_FORM_FIELDS and JS_CHECK_SINGLE_FIELD) ──
# 设计意图：disabled/required/classify 判断逻辑在多处重复，抽成共享函数通过字符串拼接引用。
# 修改判断规则时只需改一处，避免 JS_SCAN_FORM_FIELDS 和 JS_CHECK_SINGLE_FIELD 行为不一致。

