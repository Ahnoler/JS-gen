import assert from 'node:assert/strict';
import { BibBridge } from '../../../executor/bib-bridge.js';

// Behavior pin for BiB remote-input navigate actions.
// Address-bar enter from the remote canvas arrives as
//   remote:input { kind:'navigate', action:'url', url }
// and must reach CDP Page.navigate (regression: it used to fall through to
// unknown_navigate_action and get dropped silently). CDP client is stubbed —
// this pins the branch wiring inside BibBridge.handleInput, not real Chrome.

function makeBridge(calls) {
  const bib = new BibBridge({ sessionId: 's1', remoteSessionUuid: 'u1', sendBinary: () => {} });
  bib.client = {
    async send(method, params) {
      calls.push({ method, params });
      if (method === 'Page.getNavigationHistory') {
        return { currentIndex: 1, entries: [{ id: 11 }, { id: 22 }, { id: 33 }] };
      }
      return {};
    },
  };
  return bib;
}

// action 'url' → Page.navigate with the trimmed payload url
{
  const calls = [];
  const bib = makeBridge(calls);
  const res = await bib.handleInput({ kind: 'navigate', action: 'url', url: ' https://example.com/page ' });
  assert.deepEqual(res, { ok: true });
  assert.ok(
    calls.some((c) => c.method === 'Page.navigate' && c.params.url === 'https://example.com/page'),
    'url action must call Page.navigate with the trimmed url',
  );
}

// action 'url' with empty/whitespace url → rejected, no CDP call
{
  const calls = [];
  const bib = makeBridge(calls);
  const res = await bib.handleInput({ kind: 'navigate', action: 'url', url: '   ' });
  assert.deepEqual(res, { ok: false, reason: 'empty_url' });
  assert.ok(!calls.some((c) => c.method === 'Page.navigate'), 'empty url must not navigate');
}

// regression: reload still works
{
  const calls = [];
  const bib = makeBridge(calls);
  assert.deepEqual(await bib.handleInput({ kind: 'navigate', action: 'reload' }), { ok: true });
  assert.ok(calls.some((c) => c.method === 'Page.reload'), 'reload must call Page.reload');
}

// regression: back/forward still resolve history entries
{
  const calls = [];
  const bib = makeBridge(calls);
  assert.deepEqual(await bib.handleInput({ kind: 'navigate', action: 'back' }), { ok: true });
  assert.ok(
    calls.some((c) => c.method === 'Page.navigateToHistoryEntry' && c.params.entryId === 11),
    'back must go to the previous entry',
  );
}
{
  const calls = [];
  const bib = makeBridge(calls);
  assert.deepEqual(await bib.handleInput({ kind: 'navigate', action: 'forward' }), { ok: true });
  assert.ok(
    calls.some((c) => c.method === 'Page.navigateToHistoryEntry' && c.params.entryId === 33),
    'forward must go to the next entry',
  );
}

// unknown navigate action stays explicitly rejected
{
  const calls = [];
  const bib = makeBridge(calls);
  const res = await bib.handleInput({ kind: 'navigate', action: 'teleport' });
  assert.deepEqual(res, { ok: false, reason: 'unknown_navigate_action' });
}

console.log('characterize-bib-navigate-input: OK');
