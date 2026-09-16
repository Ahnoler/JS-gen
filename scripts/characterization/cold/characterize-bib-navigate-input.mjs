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

// RSCF frameId contract: CDP `Page.screencastFrame.sessionId` is constant for a whole
// screencast session (measured: hundreds of distinct frames share one id), so BibBridge
// must emit its OWN strictly increasing sequence. Dashboard clients treat a non-advancing
// frameId as "stream stalled" and loop attach/detach, so a regression here is a P0.
function makeStreamBridge(forwarded, acks) {
  const bib = new BibBridge({
    sessionId: 's1',
    remoteSessionUuid: 'u1',
    sendBinary: (packet) => forwarded.push(packet),
  });
  bib.screencastOn = true;
  bib._minForwardMs = 0;
  bib._ackPacer = { schedule: (id) => acks.push(id) };
  return bib;
}

const jpegB64 = Buffer.from([1, 2, 3, 4, 5, 6]).toString('base64');
{
  const forwarded = [];
  const acks = [];
  const bib = makeStreamBridge(forwarded, acks);
  for (let i = 0; i < 5; i += 1) {
    bib._onScreencastFrame({ sessionId: 7, data: jpegB64, metadata: { deviceWidth: 800, deviceHeight: 600 } });
  }
  assert.equal(forwarded.length, 5, 'every frame is forwarded when not throttled');
  const ids = forwarded.map((p) => p.readUInt32BE(4));
  assert.deepEqual([...ids].sort((a, b) => a - b), ids, 'RSCF frameId must be strictly increasing');
  assert.equal(new Set(ids).size, ids.length, 'each frame carries a distinct RSCF frameId');
  assert.ok(acks.length >= 5 && acks.every((a) => a === 7), 'acks must use the CDP screencast sessionId');
  assert.equal(bib._cdpSessionId, 7, 'CDP session id captured for acks');
}

// A later BibBridge instance (re-attach) must NOT restart the sequence at 1 —
// otherwise a cached baseline from the previous stream outranks new frames.
{
  const forwarded = [];
  const bib2 = makeStreamBridge(forwarded, []);
  bib2._onScreencastFrame({ sessionId: 99, data: jpegB64, metadata: {} });
  assert.ok(forwarded[0].readUInt32BE(4) > 5, 'frame sequence stays monotonic across bridge instances');
  assert.equal(bib2._cdpSessionId, 99, 'new CDP session id tracked');
}

// Client ack forwarding must target the real CDP id, never the RSCF progress sequence.
{
  const calls = [];
  const bib = makeStreamBridge([], []);
  bib._cdpSessionId = 7;
  bib.client = { send: async (method, params) => { calls.push({ method, params }); return {}; } };
  await bib.ack({ frameId: 999999 });
  assert.ok(
    calls.some((c) => c.method === 'Page.screencastFrameAck' && c.params.sessionId === 7),
    'ack must use the CDP screencast sessionId, not the RSCF frameId',
  );
}

console.log('characterize-bib-navigate-input: OK');
