/**
 * Characterization: sync req-module parse API (offline, temp rootDir).
 *
 * Pins extract → injectable LLM slice → chapters/through-chains/manifest
 * + propose-cache invalidation. Does not call a real model.
 *
 * Run:
 *   node scripts/characterization/characterize-kb-req-parse.mjs
 */
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
  existsSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
let passed = 0;

function run(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}\n${e.message}`);
    throw e;
  }
}

async function runAsync(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}\n${e.message}`);
    throw e;
  }
}

const FIXTURE_MD = readFileSync(
  join(ROOT, 'scripts/characterization/fixtures/kb-req-parse/source.md'),
  'utf8',
);

const PROPOSEABLE_CHAINS = `# 视图2：可贯通主链清单

### 主链 A：产品建库→启用

| # | 步骤 | 页面/弹窗 | ZJJK | 关键按钮 |
|---|------|-----------|------|----------|
| 1 | 进入产品库 | 产品库管理主页 | ZJJK00110131 | 【刷新产品树】 |
| 2 | 新增一级分类 | 新增产品弹窗 | ZJJK00094361 | 【确定】 |
`;

const SLICE_JSON = JSON.stringify({
  chapters: [
    {
      fileName: '01-overview.md',
      content: '# 概述\n\n## 要点摘要\n- 进入产品库\n\nZJJK00110131（产品库管理）\n',
    },
    {
      fileName: '02-config.md',
      content: '# 配置产品信息\n\n## 要点摘要\n- 保存基本信息\n\nZJJK00107304（查看产品信息）\n',
    },
  ],
  throughChainsMarkdown: PROPOSEABLE_CHAINS,
});

const PROSE_ONLY_JSON = JSON.stringify({
  chapters: [
    { fileName: '01-overview.md', content: '# 概述\n' },
  ],
  throughChainsMarkdown: `# 视图2

## 主链 1：散文

1. 进入页面
2. 点按钮
`,
});

/**
 * @param {string} rootDir temp kb req root
 * @param {object} [opts]
 * @param {string} [opts.moduleKey]
 * @param {string} [opts.sourceExt]
 * @param {string} [opts.sourceText]
 * @param {boolean} [opts.withLocalCopy]
 * @param {string} [opts.sourcePath]
 * @param {boolean} [opts.withProposeCache]
 * @returns {string} module directory
 */
function seedModule(rootDir, {
  moduleKey = 'demo-mod',
  sourceExt = '.md',
  sourceText = FIXTURE_MD,
  withLocalCopy = true,
  sourcePath,
  withProposeCache = false,
} = {}) {
  const modDir = join(rootDir, moduleKey);
  mkdirSync(join(modDir, 'chapters'), { recursive: true });
  mkdirSync(join(modDir, 'drafts'), { recursive: true });
  mkdirSync(join(modDir, 'source'), { recursive: true });
  const fileName = `fixture${sourceExt}`;
  const localRel = `source/${fileName}`;
  if (withLocalCopy) {
    writeFileSync(join(modDir, localRel), sourceText);
  }
  const resolvedSourcePath = sourcePath
    ?? (withLocalCopy ? join(modDir, localRel) : join(tmpdir(), 'kb-req-parse-missing.docx'));
  writeFileSync(
    join(modDir, 'manifest.json'),
    `${JSON.stringify({
      moduleKey,
      moduleName: '表征模块',
      sourcePath: resolvedSourcePath,
      sourceKind: 'req',
      status: 'registered',
      warnings: [],
      createdAt: '2026-09-17T00:00:00.000Z',
      updatedAt: '2026-09-17T00:00:00.000Z',
    }, null, 2)}\n`,
  );
  const link = {
    sourcePath: resolvedSourcePath,
    sourceKind: 'req',
  };
  if (withLocalCopy) {
    link.localCopy = localRel;
  }
  writeFileSync(join(modDir, 'source.link.json'), `${JSON.stringify(link, null, 2)}\n`);
  if (withProposeCache) {
    writeFileSync(join(modDir, '.draft-traj-propose.json'), `${JSON.stringify({ cacheVersion: 8, atoms: [] }, null, 2)}\n`);
  }
  return modDir;
}

async function main() {
  const extractSrc = readFileSync(join(ROOT, 'src/services/kb-req-parse/extract-source-text.js'), 'utf8');
  const sliceSrc = readFileSync(join(ROOT, 'src/services/kb-req-parse/slice-req-doc.js'), 'utf8');
  const parseSrc = readFileSync(join(ROOT, 'src/services/kb-req-parse/parse-req-module.js'), 'utf8');
  const routeSrc = readFileSync(join(ROOT, 'src/routes/v2/kb.js'), 'utf8');
  const docsSrc = readFileSync(join(ROOT, 'src/dashboard/api-docs/groups/kb.js'), 'utf8');
  const promptSrc = readFileSync(join(ROOT, 'scripts/prompts/req-module-parse-prompt.md'), 'utf8');
  const kbSrc = readFileSync(join(ROOT, 'src/services/kb-req-modules.js'), 'utf8');

  run('extract-source-text pins mammoth for docx', () => {
    assert.match(extractSrc, /mammoth/);
    assert.match(extractSrc, /\.docx/);
    assert.match(extractSrc, /SOURCE_TEXT_MAX_CHARS/);
  });

  run('slice-req-doc uses parse prompt + parseLlmJsonObject', () => {
    assert.match(sliceSrc, /req-module-parse-prompt\.md/);
    assert.match(sliceSrc, /parseLlmJsonObject/);
    assert.match(sliceSrc, /hasProposeableChainSteps/);
  });

  run('parse-req-module writes slice artifacts and clears propose cache', () => {
    assert.match(parseSrc, /through-chains\.md/);
    assert.match(parseSrc, /PROPOSE_CACHE_FILENAME|\.draft-traj-propose\.json/);
    assert.match(parseSrc, /sliced/);
    assert.match(parseSrc, /source_truncated|SOURCE_TEXT_MAX_CHARS/);
  });

  run('route wires POST parse before propose', () => {
    const parseIdx = routeSrc.indexOf("/api/v2/kb/req-modules/:moduleKey/parse");
    const proposeIdx = routeSrc.indexOf("/api/v2/kb/req-modules/:moduleKey/draft-traj/propose");
    assert.ok(parseIdx >= 0, 'parse route missing');
    assert.ok(proposeIdx >= 0, 'propose route missing');
    assert.ok(parseIdx < proposeIdx, 'parse must be registered before propose');
  });

  run('api-docs lists parse endpoint', () => {
    assert.match(docsSrc, /method:\s*'POST',\s*path:\s*'\/api\/v2\/kb\/req-modules\/\{moduleKey\}\/parse'/);
    assert.match(docsSrc, /canProposeAtoms/);
    assert.match(docsSrc, /SOURCE_REQUIRED/);
    assert.match(docsSrc, /SLICE_INVALID/);
    assert.match(docsSrc, /hasLocalSource/);
  });

  run('parse prompt requires proposeable step tables and JSON contract', () => {
    assert.match(promptSrc, /throughChainsMarkdown/);
    assert.match(promptSrc, /fileName/);
    assert.match(promptSrc, /步骤/);
    assert.match(promptSrc, /ZJJK/);
    assert.match(promptSrc, /不要发明|do not invent|不得编造/i);
    assert.match(promptSrc, /NN-.*\.md|NN-slug/);
    assert.match(promptSrc, /markdown fence|代码围栏|不要用.*围栏/);
  });

  run('getReqModule/list expose hasLocalSource', () => {
    assert.match(kbSrc, /hasLocalSource/);
  });

  const extractMod = await import(pathToFileURL(join(ROOT, 'src/services/kb-req-parse/extract-source-text.js')).href);
  const parseMod = await import(pathToFileURL(join(ROOT, 'src/services/kb-req-parse/parse-req-module.js')).href);
  const kbMod = await import(pathToFileURL(join(ROOT, 'src/services/kb-req-modules.js')).href);

  const tmp = mkdtempSync(join(tmpdir(), 'kb-req-parse-'));
  try {
    await runAsync('extract md fixture returns text', async () => {
      const srcPath = join(tmp, 'source.md');
      writeFileSync(srcPath, FIXTURE_MD);
      const out = await extractMod.extractSourceText(srcPath);
      assert.match(out.text, /ZJJK00110131/);
      assert.equal(out.truncated, false);
    });

    await runAsync('extract txt works; unsupported pdf is 400', async () => {
      const txtPath = join(tmp, 'source.txt');
      writeFileSync(txtPath, 'hello txt');
      const txt = await extractMod.extractSourceText(txtPath);
      assert.equal(txt.text, 'hello txt');
      const pdfPath = join(tmp, 'source.pdf');
      writeFileSync(pdfPath, '%PDF-fake');
      await assert.rejects(
        () => extractMod.extractSourceText(pdfPath),
        (err) => err.status === 400,
      );
    });

    await runAsync('extract truncates around 80-100k chars', async () => {
      const bigPath = join(tmp, 'big.md');
      const big = `${'字'.repeat(120_000)}\nZJJK999\n`;
      writeFileSync(bigPath, big);
      const out = await extractMod.extractSourceText(bigPath);
      assert.equal(out.truncated, true);
      assert.ok(out.text.length >= 80_000 && out.text.length <= 100_000);
    });

    seedModule(tmp, { moduleKey: 'demo-mod', withProposeCache: true });

    await runAsync('parse md fixture with fake LLM writes slice + canProposeAtoms', async () => {
      let seenPrompt = '';
      const result = await parseMod.parseReqModule({
        rootDir: tmp,
        moduleKey: 'demo-mod',
        callLLM: async (text) => {
          seenPrompt = String(text);
          return SLICE_JSON;
        },
      });
      assert.equal(result.moduleKey, 'demo-mod');
      assert.equal(result.status, 'sliced');
      assert.equal(result.chapterCount, 2);
      assert.equal(result.chainCount, 1);
      assert.equal(result.canProposeAtoms, true);
      assert.equal(result.sourceDoc, 'source/fixture.md');
      assert.ok(Array.isArray(result.warnings));
      const modDir = join(tmp, 'demo-mod');
      assert.equal(readFileSync(join(modDir, 'chapters', '01-overview.md'), 'utf8'), JSON.parse(SLICE_JSON).chapters[0].content);
      assert.equal(readFileSync(join(modDir, 'chapters', '02-config.md'), 'utf8'), JSON.parse(SLICE_JSON).chapters[1].content);
      assert.equal(readdirSync(join(modDir, 'chapters')).filter((n) => n.endsWith('.md')).length, 2);
      const chains = readFileSync(join(modDir, 'through-chains.md'), 'utf8');
      assert.match(chains, /### 主链 A/);
      const manifest = JSON.parse(readFileSync(join(modDir, 'manifest.json'), 'utf8'));
      assert.equal(manifest.status, 'sliced');
      assert.ok(manifest.updatedAt > '2026-09-17T00:00:00.000Z');
      assert.equal(existsSync(join(modDir, '.draft-traj-propose.json')), false);
      assert.match(seenPrompt, /产品库管理/);
      assert.match(seenPrompt, /req-module-parse|视图2|throughChainsMarkdown|章节/);
    });

    await runAsync('parse prefers localCopy over unreadable sourcePath', async () => {
      const modDir = seedModule(tmp, {
        moduleKey: 'prefer-local',
        sourcePath: '/no/such/server/path.docx',
      });
      const result = await parseMod.parseReqModule({
        rootDir: tmp,
        moduleKey: 'prefer-local',
        callLLM: async () => SLICE_JSON,
      });
      assert.equal(result.sourceDoc, 'source/fixture.md');
      assert.ok(existsSync(join(modDir, 'through-chains.md')));
    });

    await runAsync('parse falls back to readable sourcePath when localCopy missing', async () => {
      const fallback = join(tmp, 'fallback-src.md');
      writeFileSync(fallback, FIXTURE_MD);
      seedModule(tmp, {
        moduleKey: 'fallback-path',
        withLocalCopy: false,
        sourcePath: fallback,
      });
      const result = await parseMod.parseReqModule({
        rootDir: tmp,
        moduleKey: 'fallback-path',
        callLLM: async () => SLICE_JSON,
      });
      assert.equal(result.sourceDoc, fallback);
      assert.equal(result.canProposeAtoms, true);
    });

    await runAsync('SOURCE_REQUIRED when no localCopy and sourcePath unreadable', async () => {
      seedModule(tmp, {
        moduleKey: 'no-source',
        withLocalCopy: false,
        sourcePath: join(tmp, 'missing-forever.docx'),
      });
      await assert.rejects(
        () => parseMod.parseReqModule({
          rootDir: tmp,
          moduleKey: 'no-source',
          callLLM: async () => SLICE_JSON,
        }),
        (err) => err.code === 'SOURCE_REQUIRED' && err.status === 400,
      );
    });

    await runAsync('missing module is NOT_FOUND', async () => {
      await assert.rejects(
        () => parseMod.parseReqModule({
          rootDir: tmp,
          moduleKey: 'missing-mod',
          callLLM: async () => SLICE_JSON,
        }),
        (err) => err.code === 'NOT_FOUND',
      );
    });

    await runAsync('SLICE_INVALID does not write artifacts', async () => {
      const modDir = seedModule(tmp, { moduleKey: 'bad-slice' });
      writeFileSync(join(modDir, 'chapters', 'stale.md'), '# keep me\n');
      await assert.rejects(
        () => parseMod.parseReqModule({
          rootDir: tmp,
          moduleKey: 'bad-slice',
          callLLM: async () => PROSE_ONLY_JSON,
        }),
        (err) => err.code === 'SLICE_INVALID' && err.status === 400,
      );
      assert.equal(existsSync(join(modDir, 'through-chains.md')), false);
      assert.equal(readFileSync(join(modDir, 'chapters', 'stale.md'), 'utf8'), '# keep me\n');
      const manifest = JSON.parse(readFileSync(join(modDir, 'manifest.json'), 'utf8'));
      assert.equal(manifest.status, 'registered');
    });

    await runAsync('LLM throw maps to 502', async () => {
      seedModule(tmp, { moduleKey: 'llm-fail' });
      await assert.rejects(
        () => parseMod.parseReqModule({
          rootDir: tmp,
          moduleKey: 'llm-fail',
          callLLM: async () => {
            throw new Error('upstream down');
          },
        }),
        (err) => err.status === 502,
      );
    });

    await runAsync('source_truncated warning on oversized source', async () => {
      seedModule(tmp, {
        moduleKey: 'trunc-mod',
        sourceText: `${'字'.repeat(120_000)}\n产品库 ZJJK00110131\n`,
      });
      const result = await parseMod.parseReqModule({
        rootDir: tmp,
        moduleKey: 'trunc-mod',
        callLLM: async () => SLICE_JSON,
      });
      assert.ok(result.warnings.includes('source_truncated'));
    });

    await runAsync('unsupported source type is 400', async () => {
      seedModule(tmp, { moduleKey: 'pdf-mod', sourceExt: '.pdf', sourceText: '%PDF-fake' });
      await assert.rejects(
        () => parseMod.parseReqModule({
          rootDir: tmp,
          moduleKey: 'pdf-mod',
          callLLM: async () => SLICE_JSON,
        }),
        (err) => err.status === 400,
      );
    });

    await runAsync('without force, overwrite existing slice and warn', async () => {
      const modDir = seedModule(tmp, { moduleKey: 'reparse' });
      writeFileSync(join(modDir, 'through-chains.md'), '# old\n');
      writeFileSync(join(modDir, 'chapters', '00-old.md'), '# old chapter\n');
      const result = await parseMod.parseReqModule({
        rootDir: tmp,
        moduleKey: 'reparse',
        force: false,
        callLLM: async () => SLICE_JSON,
      });
      assert.ok(result.warnings.includes('slice_overwritten'));
      assert.equal(existsSync(join(modDir, 'chapters', '00-old.md')), false);
      assert.ok(existsSync(join(modDir, 'chapters', '01-overview.md')));
    });

    await runAsync('getReqModule and list expose hasLocalSource', async () => {
      seedModule(tmp, { moduleKey: 'with-copy', withLocalCopy: true });
      seedModule(tmp, { moduleKey: 'no-copy', withLocalCopy: false, sourcePath: '/nope.docx' });
      const withCopy = await kbMod.getReqModule({ rootDir: tmp, moduleKey: 'with-copy' });
      const noCopy = await kbMod.getReqModule({ rootDir: tmp, moduleKey: 'no-copy' });
      assert.equal(withCopy.hasLocalSource, true);
      assert.equal(noCopy.hasLocalSource, false);
      const rows = await kbMod.listReqModules({ rootDir: tmp });
      assert.equal(rows.find((r) => r.moduleKey === 'with-copy').hasLocalSource, true);
      assert.equal(rows.find((r) => r.moduleKey === 'no-copy').hasLocalSource, false);
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  console.log(`OK ${passed}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
