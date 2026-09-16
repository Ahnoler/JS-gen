/**
 * Tree-node text cleanup: DOM semantic span, (N) strip, trailing dash, [V-…] keep.
 *
 *   node scripts/characterization/cold/characterize-tree-node-text.mjs
 */
import assert from 'node:assert/strict';
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

  console.log('characterize-tree-node-text: OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
