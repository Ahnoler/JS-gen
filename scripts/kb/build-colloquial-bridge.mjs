/**
 * Build the colloquial bridge CANDIDATE pool from three domain-corpus sources.
 *
 * Hard discipline (G2):
 *  - reads ONLY the flows cards and the per-module chapters / through-chains / wet-test corpus;
 *  - NEVER reads kb-recall-eval.v2.json / kb-recall-failures.v1.json / the old synonyms table;
 *  - ZERO imports from recall/eval modules (pure string/regex corpus processing);
 *  - every candidate carries sourceKind + sourceRef (file + line/leaf) + evidence.
 *
 * Sources (design §5, B3 mix applies at selection time, not extraction time):
 *  A corpus-card     — same-card alias/keyword non-identical synonym framings
 *  B corpus-req-doc  — req-doc alternative wordings (「A」（B）/ A vs B in chapters, through-chains)
 *  C wet-test-drift  — wet-test.md wording lines: SUT button/label vs doc wording pairs
 *
 * Run: node scripts/kb/build-colloquial-bridge.mjs   → writes tmp/kb-bridge/candidates.json
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';

const REQ_ROOT = 'data/kb/req';
const FLOWS_DIR = 'data/kb/flows';
const OUT = 'tmp/kb-bridge/candidates.json';

const candidates = [];
const seen = new Set();
const push = (c) => {
  const key = c.term + '=>' + c.expand.join('|');
  if (seen.has(key)) return;
  seen.add(key);
  candidates.push(c);
};

const isCjk = (s) => /[\u4e00-\u9fff]/.test(s);
const clean = (s) => s.replace(/[「」『』"']/g, '').trim();
const ok = (s) => s && s.length >= 2 && s.length <= 12 && isCjk(s) && !/[（）：:;；,，。|]/.test(s);

/* ---------------- A: card-surface synonyms ----------------
   Same card, alias vs keyword where one contains the other with real extra
   framing (e.g. alias 档案入库申请 vs keyword 入库申请), or two aliases sharing
   a head word but diverging (embedded-synonym framings usable as bridges). */
function extractCardSynonyms() {
  for (const f of readdirSync(FLOWS_DIR)) {
    if (!f.endsWith('.json')) continue;
    const stem = f.replace(/\.json$/, '');
    const card = JSON.parse(readFileSync(path.join(FLOWS_DIR, f), 'utf8'));
    const surfaces = [...(card.aliases || []), ...(card.keywords || [])].filter(ok);
    // alias ⊂ longer alias: the shorter is a legitimate colloquial short form
    for (const a of card.aliases || []) {
      if (!ok(a)) continue;
      for (const k of card.keywords || []) {
        if (!ok(k) || k === a) continue;
        if (a.includes(k) && a.length > k.length + 1) {
          push({
            term: k,
            expand: [a],
            sourceKind: 'corpus-card',
            sourceRef: `data/kb/flows/${f}`,
            evidence: `keyword「${k}」⊂ alias「${a}」（同卡 ${stem}）`,
            stem,
          });
        } else if (k.includes(a) && k.length > a.length + 1) {
          push({
            term: a,
            expand: [k],
            sourceKind: 'corpus-card',
            sourceRef: `data/kb/flows/${f}`,
            evidence: `alias「${a}」⊂ keyword「${k}」（同卡 ${stem}）`,
            stem,
          });
        }
      }
    }
  }
}

/* ---------------- B: req-doc alternative wordings ----------------
   Patterns in chapters/*.md and through-chains.md:
   b1 「A」（B）        — quoted term glossed by an alternative in parens
   b2 「A」（文档「B」） — explicit doc-wording variant
   b3 SUT「A」文档「B」  — inline SUT/doc pairs mentioned in chains (rare) */
function* reqDocLines() {
  for (const d of readdirSync(REQ_ROOT)) {
    const dir = path.join(REQ_ROOT, d);
    let entries;
    try {
      if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
    } catch { continue; }
    if (!readdirSync(dir).some((x) => x === 'chapters' || x === 'through-chains.md')) continue;
    const files = [];
    const chapDir = path.join(dir, 'chapters');
    if (existsSync(chapDir)) for (const c of readdirSync(chapDir)) if (c.endsWith('.md')) files.push(path.join('chapters', c));
    if (existsSync(path.join(dir, 'through-chains.md'))) files.push('through-chains.md');
    for (const rel of files) {
      const full = path.join(dir, rel);
      const lines = readFileSync(full, 'utf8').split('\n');
      for (let i = 0; i < lines.length; i++) yield { module: d, file: `data/kb/req/${d}/${rel}`, line: i + 1, text: lines[i] };
    }
  }
}

function extractReqDocAlternatives() {
  for (const { module: mod, file, line, text } of reqDocLines()) {
    if (text.length > 4000) continue;
    // b1: 「A」（B） gloss pattern, both CJK short
    for (const m of text.matchAll(/[「]([^」]{2,12})[」][（]([^（）「」]{2,12})[）]/g)) {
      const a = clean(m[1]);
      const b = clean(m[2]);
      if (ok(a) && ok(b) && a !== b && !/待湿测|章|协议|口径|弹窗|列表|主页|文档/.test(b)) {
        push({
          term: a,
          expand: [b],
          sourceKind: 'corpus-req-doc',
          sourceRef: `${file}:${line}`,
          evidence: `「${a}」（${b}）`,
          module: mod,
        });
      }
    }
    // b2: A（B） bare parens gloss inside line when both short CJK and no digits
    for (const m of text.matchAll(/([\u4e00-\u9fff]{2,10})（([\u4e00-\u9fff]{2,8})）/g)) {
      const a = m[1];
      const b = m[2];
      if (a === b) continue;
      // only when b looks like a lexical variant (edit distance-ish: shares >=1 bigram or same length)
      const share = [...b].filter((ch) => a.includes(ch)).length;
      if (ok(a) && ok(b) && (share >= Math.min(2, b.length - 1))) {
        push({
          term: a,
          expand: [b],
          sourceKind: 'corpus-req-doc',
          sourceRef: `${file}:${line}`,
          evidence: `${a}（${b}）`,
          module: mod,
        });
      }
    }
  }
}

/* ---------------- C: wet-test wording drift pairs ----------------
   wet-test.md wording lines carry leaf-numbered rows:
   | <leaf> | ZJJK... | page | menu | drift | ... SUT「A」... 文档「B」...
   Direction: doc-side word is what users read in requirements; SUT-side is
   what the product shows. Bridge direction = doc/slang term -> SUT card term. */
function extractWetTestDrift() {
  for (const d of readdirSync(REQ_ROOT)) {
    const wt = path.join(REQ_ROOT, d, 'wet-test.md');
    if (!existsSync(wt)) continue;
    const lines = readFileSync(wt, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const text = lines[i];
      if (!/wording/.test(text)) continue;
      const leaf = (text.match(/^\|\s*(\d+)\s*\|/) || [])[1];
      const zjjk = (text.match(/ZJJK[0-9A-Za-z]+/) || [])[0] || '';
      // pair patterns (order-agnostic)
      const pairs = [];
      const m1 = text.match(/SUT\s*[按钮名菜单为]*[「]([^」]{2,12})[」][^「」]{0,24}?文档[写口径为]*[「]([^」]{2,12})[」]/);
      const m2 = text.match(/文档[写口径为]*[「]([^」]{2,12})[」][^「」]{0,24}?SUT\s*[为用]?[「]([^」]{2,12})[」]/);
      const m3 = text.match(/[「]([^」]{2,12})[」]（文档[写口径为]*[「]([^」]{2,12})[」]）/);
      let sut = null;
      let doc = null;
      if (m1) { sut = clean(m1[1]); doc = clean(m2 ? m2[1] : m1[2]); }
      else if (m2) { doc = clean(m2[1]); sut = clean(m2[2]); }
      else if (m3) { sut = clean(m3[1]); doc = clean(m3[2]); }
      if (sut && doc && ok(sut) && ok(doc) && sut !== doc) pairs.push([sut, doc]);
      for (const [s, dd] of pairs) {
        push({
          term: dd,
          expand: [s],
          sourceKind: 'wet-test-drift',
          sourceRef: `${d}/wet-test.md 叶${leaf || '?'}:${i + 1}${zjjk ? ' ' + zjjk : ''}`,
          evidence: `SUT「${s}」vs 文档「${dd}」`,
          module: d,
        });
      }
    }
  }
}

extractCardSynonyms();
extractReqDocAlternatives();
extractWetTestDrift();

writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), total: candidates.length, candidates }, null, 1));
const byKind = {};
for (const c of candidates) byKind[c.sourceKind] = (byKind[c.sourceKind] || 0) + 1;
console.log('candidate pool:', candidates.length, JSON.stringify(byKind));
console.log('written', OUT);
