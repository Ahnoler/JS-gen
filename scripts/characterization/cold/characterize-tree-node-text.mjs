/**
 * Tree-node text cleanup: DOM semantic span, (N) strip, trailing dash, [V-…] keep.
 *
 *   node scripts/characterization/cold/characterize-tree-node-text.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import {
  stripVolatileTreeText,
  buildTreeNodeXPathSmart,
  treeSemanticTextFromNode,
  PAGE_LOCATOR_HELPERS,
} from '../../../src/cdp/locator-candidates.js';

const SPLICE_FIXTURE = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>tree text</title></head><body>
<span class="custom-tree-node" id="splice-node">
  <span style="color:#333"> 年龄限制</span>- 
</span>
</body></html>`;

const COUNT_FIXTURE = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>tree count</title></head><body>
<div class="el-tree-node">
  <div class="el-tree-node__content" id="count-leaf">
    <span class="custom-tree-node">
      <span>金融新产品</span>(7)
    </span>
  </div>
</div>
</body></html>`;

const REPLAY_TREE_FIXTURE = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>replay tree</title></head><body>
<div class="el-tree">
  <div class="el-tree-node">
    <div class="el-tree-node__content" id="replay-tree-node">
      <span class="custom-tree-node"><span>金融新产品</span>(3)</span>
    </div>
  </div>
</div>
</body></html>`;

const BADGE_FIXTURE = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>tree badge</title></head><body>
<div class="el-tree-node__content" id="badge-leaf">
  <span class="el-tree-node__label">节点名</span>
  <sup class="el-badge__content">3</sup>
</div>
</body></html>`;

function treeTextExpr(selector) {
  const sel = JSON.stringify(selector);
  return `(() => {
${PAGE_LOCATOR_HELPERS}
    const el = document.querySelector(${sel});
    return treeSemanticTextFromNode(el);
  })()`;
}

function ok(name) {
  console.log(`ok: ${name}`);
}

function extractDurableBlob() {
  const src = readFileSync('scripts/controller/actions/replay_js.py', 'utf8');
  const m = src.match(/_JS_CLICK_DURABLE = r'''([\s\S]*?)'''/);
  assert.ok(m, '_JS_CLICK_DURABLE present in replay_js.py');
  return m[1];
}

function stripVolatileBlock(blob) {
  return blob.split('const stripVolatile')[1].split('const wantRaw')[0];
}

async function main() {
  {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent(SPLICE_FIXTURE);
    const text = await page.evaluate(treeTextExpr('#splice-node'));
    assert.equal(text, '年龄限制', `splice dash: got ${JSON.stringify(text)}`);
    await browser.close();
    ok('DOM splice dash → 年龄限制');
  }

  {
    assert.equal(stripVolatileTreeText('金融新产品(7)'), '金融新产品');
    ok('strip count suffix (7)');
  }

  {
    assert.equal(
      stripVolatileTreeText('KB测一级-20260907-1835(1)'),
      'KB测一级-20260907-1835',
    );
    ok('strip count keeps middle hyphen');
  }

  {
    assert.equal(stripVolatileTreeText('测试111[V-0.0.1]'), '测试111[V-0.0.1]');
    ok('keep [V-…] version badge');
  }

  {
    const xp = buildTreeNodeXPathSmart({ text: '贷款(272)' });
    assert.ok(xp.includes('贷款'));
    assert.ok(!xp.includes('(272)'));
    ok('xpath strips (272)');
  }

  {
    const xp = buildTreeNodeXPathSmart({ text: '测试111[V-0.0.1]' });
    assert.ok(xp.includes('[V-0.0.1]') || xp.includes('V-0.0.1'), xp);
    ok('xpath keeps [V-0.0.1]');
  }

  assert.equal(typeof treeSemanticTextFromNode, 'function');
  ok('treeSemanticTextFromNode exported');

  {
    const bPy = readFileSync('scripts/manual_recorder/js_parts/b.py', 'utf8');
    const treeBranch = bPy.split('// tree node')[1]?.split('// Never emit')[0] || '';
    assert.ok(
      treeBranch.includes('treeSemanticTextFromNode'),
      'manual sidebar tree click must use treeSemanticTextFromNode',
    );
    ok('manual b.py sidebar uses treeSemanticTextFromNode');
  }

  {
    const helpers = readFileSync('src/cdp/page-locator-helpers.js', 'utf8');
    const snap = helpers.split('function buildLocatorSnap')[1]?.split(/\n  function /)[0] || '';
    assert.ok(
      /kind\s*===\s*['"]tree_node['"]/.test(snap) && snap.includes('treeSemanticTextFromNode'),
      'buildLocatorSnap must clean tree_node text via treeSemanticTextFromNode',
    );
    ok('buildLocatorSnap tree_node cleaning pinned');
  }

  {
    const snapTextExpr = `(() => {
${PAGE_LOCATOR_HELPERS}
  const host = document.querySelector('#count-leaf');
  const loc = buildLocatorSnap(host, '', absXPath(host), '', { targetKind: 'tree_node' });
  return loc.text;
})()`;
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent(COUNT_FIXTURE);
    const snapText = await page.evaluate(snapTextExpr);
    assert.equal(snapText, '金融新产品', `buildLocatorSnap count: got ${JSON.stringify(snapText)}`);
    await browser.close();
    ok('buildLocatorSnap strips (N) on tree_node');
  }

  {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent(BADGE_FIXTURE);
    const text = await page.evaluate(treeTextExpr('#badge-leaf'));
    assert.equal(text, '节点名', `badge fallback: got ${JSON.stringify(text)}`);
    await browser.close();
    ok('treeSemanticTextFromNode strips badge on fallback');
  }

  {
    const blob = extractDurableBlob();
    const stripBlock = stripVolatileBlock(blob);
    assert.ok(
      !/\[\s*V[-\d.]+\s*\]\$/i.test(stripBlock),
      'replay stripVolatile must not strip [V-…]',
    );
    assert.ok(
      stripBlock.includes('\\(\\d+\\)$'),
      'stripVolatile must strip trailing (N)',
    );
    assert.ok(
      stripBlock.includes('replace(/-$/'),
      'stripVolatile must strip trailing decorative dash',
    );
    ok('replay_js stripVolatile semantics pinned');
  }

  {
    const selectTree = readFileSync(
      'scripts/controller/actions/js_snippets/select_tree.py',
      'utf8',
    );
    assert.ok(
      selectTree.includes('stripTreeText') && selectTree.includes('nodeMatches'),
      'select_tree must strip both sides for nodeMatches',
    );
    ok('select_tree bilateral strip pinned');
  }

  {
    const treePicker = readFileSync(
      'scripts/controller/actions/js_snippets/tree_picker.py',
      'utf8',
    );
    const dfs = treePicker.split('JS_TREE_PICKER_DFS_PATH')[1] || '';
    assert.ok(
      dfs.includes('stripTreeText') && dfs.includes('label === want'),
      'tree_picker DFS must strip both sides before label === want',
    );
    ok('tree_picker DFS bilateral strip pinned');
  }

  {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent(REPLAY_TREE_FIXTURE);
    const matched = await page.evaluate(() => {
      const norm = (s) => (s || '').replace(/\s+/g, '').trim();
      const stripVolatile = (s) => norm(s)
        .replace(/\(\d+\)$/, '')
        .replace(/-$/, '')
        .slice(0, 40);
      const isVisible = (el) => {
        if (!el) return false;
        const st = getComputedStyle(el);
        const box = el.getBoundingClientRect();
        if (st.display === 'none' || st.visibility === 'hidden' || box.width < 1 || box.height < 1) return false;
        return true;
      };
      const pickTreeNode = (rawWant) => {
        const base = stripVolatile(rawWant);
        if (!base) return null;
        const roots = [...document.querySelectorAll('.el-tree-node__content, .el-tree-node__label')].filter(isVisible);
        for (const el of roots) {
          const t = stripVolatile(el.innerText || el.textContent);
          if (t === base) return el;
        }
        return null;
      };
      const node = pickTreeNode('金融新产品(7)');
      return node ? stripVolatile(node.innerText || node.textContent) : null;
    });
    assert.equal(matched, '金融新产品', `pickTreeNode drift: got ${matched}`);
    await browser.close();
    ok('replay pickTreeNode matches (7) recorded vs (3) live');
  }

  console.log('characterize-tree-node-text: OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
