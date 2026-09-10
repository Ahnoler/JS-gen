/**
 * T2 two-way mechanical verification of bridge candidates (CORPUS GREP ONLY —
 * no matcher runs, no imports from recall/eval modules, no eval-fixture reads).
 *
 * term-side : must appear in real business text (module corpus / card surface)
 * expand-side: must appear on a card surface (data/kb/flows)
 *
 * Run: node tmp/kb-bridge/t2-verify.mjs  → tmp/kb-bridge/T2-verified.json
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';

const pool = JSON.parse(readFileSync('tmp/kb-bridge/candidates.json', 'utf8')).candidates;

/* card surface index: stem -> concatenated surface text */
const cardSurface = {};
for (const f of readdirSync('data/kb/flows')) {
  if (!f.endsWith('.json')) continue;
  const c = JSON.parse(readFileSync(path.join('data/kb/flows', f), 'utf8'));
  cardSurface[f.replace(/\.json$/, '')] = [
    c.flow, ...(c.aliases || []), ...(c.keywords || []),
    ...(c.nodes || []).flatMap((n) => [n.page, n.enter, ...(n.buttons || [])]),
  ].filter(Boolean).join('\n');
}

/* business-text corpus per module (term-side plausibility) */
const corpusByModule = {};
for (const d of readdirSync('data/kb/req')) {
  const dir = path.join('data/kb/req', d);
  try { if (!existsSync(dir) || !statSync(dir).isDirectory()) continue; } catch { continue; }
  const parts = [];
  const chap = path.join(dir, 'chapters');
  if (existsSync(chap)) for (const f of readdirSync(chap)) if (f.endsWith('.md')) parts.push(readFileSync(path.join(chap, f), 'utf8'));
  for (const f of ['through-chains.md', 'wet-test.md']) if (existsSync(path.join(dir, f))) parts.push(readFileSync(path.join(dir, f), 'utf8'));
  if (parts.length) corpusByModule[d] = parts.join('\n');
}

const results = [];
const rejected = [];
const stats = { total: pool.length, expandOk: 0, termOk: 0, both: 0 };
for (const cand of pool) {
  const expand = cand.expand[0];
  // expand-side: hit a card surface (same-card first)
  let expandHit = false;
  if (cand.stem && cardSurface[cand.stem] && cardSurface[cand.stem].includes(expand)) expandHit = cand.stem;
  else for (const [stem, hay] of Object.entries(cardSurface)) if (hay.includes(expand)) { expandHit = stem; break; }
  // term-side: hit module corpus (business text), else its own card surface (A-class)
  let termHit = false;
  if (cand.module && corpusByModule[cand.module] && corpusByModule[cand.module].includes(cand.term)) termHit = cand.module;
  else for (const [mod, hay] of Object.entries(corpusByModule)) if (hay.includes(cand.term)) { termHit = mod; break; }
  if (!termHit && cand.stem && cardSurface[cand.stem] && cardSurface[cand.stem].includes(cand.term)) termHit = cand.stem;
  if (expandHit) stats.expandOk++;
  if (termHit) stats.termOk++;
  if (expandHit && termHit) { stats.both++; results.push({ ...cand, expandHitCard: expandHit, termHitIn: termHit }); }
  else rejected.push({ term: cand.term, expand, sourceKind: cand.sourceKind, why: expandHit ? 'term-side absent from corpus' : 'expand absent from all card surfaces' });
}

console.log('two-way funnel: pool=' + pool.length, 'expandHit=' + stats.expandOk, 'termHit=' + stats.termOk, 'BOTH=' + stats.both, 'rejected=' + rejected.length);
writeFileSync('tmp/kb-bridge/T2-verified.json', JSON.stringify({ stats, verified: results, rejected }, null, 1));
