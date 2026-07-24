// Multi-Turn Session Mode — thin orchestrator

import { loadPhaseDescriptions, collectSessionDom, createSessionContext } from './state.js';
import { wireUi } from './ui.js';
import { wirePhaseUi } from './phase-ui.js';
import { wireLifecycle } from './lifecycle.js';
import { wirePickers } from './pickers.js';
import { wireQuickActions } from './quick-actions.js';

export function initSessionMode() {
  loadPhaseDescriptions();
  const dom = collectSessionDom();
  if (!dom.sessNewBtn) return;

  const ctx = createSessionContext(dom);

  // Order matters: ui helpers first; lifecycle installs executeSessionStep;
  // phase-ui / pickers / quick-actions may call it via ctx.
  wireUi(ctx);
  wirePhaseUi(ctx);
  wireLifecycle(ctx);
  wirePickers(ctx);
  wireQuickActions(ctx);

  ctx.updateButtons();
}
