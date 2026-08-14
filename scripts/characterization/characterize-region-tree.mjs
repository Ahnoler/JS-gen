/**
 * Region tree + step hierarchy evidence.
 *   node scripts/characterization/characterize-region-tree.mjs
 */
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
function ok(n) { console.log(`ok: ${n}`); }

{
  const { deriveRegionRef } = await import('../../src/services/region-tree.js');
  assert.deepEqual(deriveRegionRef({ layers: [
    { role: 'tab', label: '客户基本信息' },
    { role: 'section', label: '对公客户概况' },
    { role: 'titlebox', label: '基本信息' },
  ] }), { regionId: 'titlebox:基本信息', parentRegionId: 'section:对公客户概况' });
  assert.deepEqual(deriveRegionRef({ layers: [{ role: 'overlay', label: '提示' }] }),
    { regionId: 'overlay:提示', parentRegionId: '' });
  assert.deepEqual(deriveRegionRef({ region_id: 'tab:A|section:B' }),
    { regionId: 'section:B', parentRegionId: 'tab:A' });
  assert.deepEqual(deriveRegionRef({ region_id: 'table' }),
    { regionId: 'table', parentRegionId: '' });
  assert.deepEqual(deriveRegionRef({ display_group: '客户基本信息 / 对公客户概况' }),
    { regionId: '对公客户概况', parentRegionId: '客户基本信息' });
  assert.deepEqual(deriveRegionRef({ region_label: '只有一个区' }),
    { regionId: '只有一个区', parentRegionId: '' });
  assert.deepEqual(deriveRegionRef({}), { regionId: '', parentRegionId: '' });
  ok('deriveRegionRef fallback chain');
}

{
  const { assembleRegionTree } = await import('../../src/services/region-tree.js');
  const items = [
    { layers: [{ role: 'tab', label: '客户基本信息' }, { role: 'section', label: '对公客户概况' }, { role: 'titlebox', label: '基本信息' }] },
    { layers: [{ role: 'tab', label: '客户基本信息' }, { role: 'section', label: '对公客户概况' }] },
    { layers: [] },
  ];
  const tree = assembleRegionTree(items, { pageLabel: '' });
  assert.equal(tree.roots.length, 2);
  const tab = tree.roots.find((r) => r.id === 'tab:客户基本信息');
  assert.ok(tab);
  assert.equal(tab.parentId, null);
  assert.equal(tab.children.length, 1);
  const sec = tab.children[0];
  assert.equal(sec.id, 'section:对公客户概况');
  assert.equal(sec.parentId, 'tab:客户基本信息');
  assert.deepEqual(sec.controls, [{ elementIndex: 1 }]);
  assert.equal(sec.children.length, 1);
  assert.equal(sec.children[0].id, 'titlebox:基本信息');
  assert.equal(sec.children[0].parentId, 'section:对公客户概况');
  assert.deepEqual(sec.children[0].controls, [{ elementIndex: 0 }]);
  const other = tree.roots.find((r) => r.id === 'other');
  assert.ok(other);
  assert.equal(other.role, 'other');
  assert.deepEqual(other.controls, [{ elementIndex: 2 }]);
  ok('assembleRegionTree prefix merge + other bucket');
}

{
  const { assembleRegionTree } = await import('../../src/services/region-tree.js');
  const paged = assembleRegionTree([
    { layers: [{ role: 'page', label: '对公客户管理' }, { role: 'tab', label: 'T1' }] },
    { layers: [{ role: 'tab', label: 'T1' }, { role: 'page', label: '内层页' }, { role: 'section', label: 'S1' }] },
  ], { pageLabel: '对公客户管理' });
  const pageRoot = paged.roots.find((r) => r.role === 'page');
  assert.ok(pageRoot);
  assert.equal(pageRoot.id, 'page:对公客户管理');
  const t1 = pageRoot.children.find((c) => c.id === 'tab:T1');
  assert.ok(t1);
  assert.equal(t1.children[0].id, 'section:S1');
  const hasPageChild = (n) => n.children.some((c) => c.role === 'page');
  assert.equal(hasPageChild(pageRoot), false);
  assert.equal(hasPageChild(t1), false);
  ok('page only at root; inner page dropped');
}

{
  const { assembleRegionTree } = await import('../../src/services/region-tree.js');
  const twoPages = assembleRegionTree([
    { layers: [{ role: 'page', label: 'A' }, { role: 'tab', label: 'X' }] },
    { layers: [{ role: 'page', label: 'B' }, { role: 'tab', label: 'X' }] },
  ], { pageLabel: '' });
  assert.equal(twoPages.roots.length, 2);
  for (const r of twoPages.roots) {
    assert.equal(r.role, 'page');
    assert.equal(r.children[0].id, 'tab:X');
  }
  ok('different page labels are different roots');
}

console.log('characterize-region-tree: ok');
