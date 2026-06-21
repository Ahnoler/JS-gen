// AI Explore (Browser Use + Playwright Pipeline)
// Extracted from test-dashboard.js initAIExplore IIFE

import { ts } from './utils.js';
import { escapeHtml } from './swagger-api.js';

export function initAIExplore() {
  const exploreModel = document.getElementById('exploreModel');
  const exploreTask = document.getElementById('exploreTask');
  const exploreStartBtn = document.getElementById('exploreStartBtn');
  const exploreCancelBtn = document.getElementById('exploreCancelBtn');
  const exploreStatus = document.getElementById('exploreStatus');
  const exploreTimeline = document.getElementById('exploreTimeline');
  const exploreLogTerminal = document.getElementById('exploreLogTerminal');
  const exploreTrajectoryId = document.getElementById('exploreTrajectoryId');

  if (!exploreStartBtn) return;

  let exploreSSE = null;
  let exploreRunning = false;
  let exploreAbortController = null;

  // Gate all execution buttons
  function setGlobalLock(locked) {
    window.__execLock__.running = locked;
    const btns = document.querySelectorAll('#genBtn, #exploreStartBtn, #sessStepBtn, #genRunBtn');
    btns.forEach(b => { if (b && !b.id.match(/^(exploreCancel|sessCancel)/)) b.disabled = locked; });
  }

  function exploreLog(type, msg) {
    const line = document.createElement('div');
    line.className = 'log-line ' + type;
    line.innerHTML = '<span class="ts">' + ts() + '</span>' + msg.replace(/</g,'&lt;').replace(/>/g,'&gt;');
    exploreLogTerminal.appendChild(line);
    exploreLogTerminal.scrollTop = exploreLogTerminal.scrollHeight;
  }

  function exploreStep(id, status, label, detail) {
    const emptyState = exploreTimeline.querySelector('.empty-state');
    if (emptyState) emptyState.remove();

    const icons = {
      pending: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>',
      running: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
      success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>',
      failed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    };

    const existing = document.getElementById('explore-step-' + id);
    if (existing) {
      const dot = existing.querySelector('.timeline-dot');
      dot.className = 'timeline-dot ' + status;
      dot.innerHTML = icons[status] || icons.pending;
      const sl = existing.querySelector('.timeline-status');
      sl.className = 'timeline-status ' + (status === 'success' ? 'pass' : status === 'failed' ? 'fail' : status);
      sl.textContent = status.toUpperCase();
      existing.querySelector('.timeline-label-text').textContent = label;
      if (detail) {
        existing.querySelector('.timeline-detail').innerHTML = '<pre>' + detail + '</pre>';
        existing.querySelector('.timeline-detail').classList.add('open');
      }
      return;
    }

    const item = document.createElement('div');
    item.className = 'timeline-item';
    item.id = 'explore-step-' + id;
    item.innerHTML = `
      <div class="timeline-dot ${status}">${icons[status]}</div>
      <div class="timeline-content">
        <div class="timeline-label">
          <span class="timeline-label-text">${label}</span>
          <span class="timeline-status ${status === 'success' ? 'pass' : status === 'failed' ? 'fail' : status}">${status.toUpperCase()}</span>
        </div>
        <div class="timeline-detail${detail ? ' open' : ''}">${detail ? '<pre>' + detail + '</pre>' : ''}</div>
      </div>`;
    exploreTimeline.appendChild(item);
  }

  // Load models on page init
  async function loadExploreModels() {
    try {
      const r = await fetch('/api/models');
      const data = await r.json();
      exploreModel.innerHTML = '';
      const sessModelEl = document.getElementById('sessModel');
      const models = data.models || [];
      if (models.length === 0) {
        exploreModel.innerHTML = '<option value="">No models available</option>';
        if (sessModelEl) sessModelEl.innerHTML = '<option value="">No models</option>';
        return;
      }
      models.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.id;
        if (m.id === data.defaultModel) opt.selected = true;
        exploreModel.appendChild(opt);
        if (sessModelEl) {
          const opt2 = document.createElement('option');
          opt2.value = m.id;
          opt2.textContent = m.id;
          if (m.id === data.defaultModel) opt2.selected = true;
          sessModelEl.appendChild(opt2);
        }
      });
      exploreStartBtn.disabled = false;
    } catch (e) {
      exploreModel.innerHTML = '<option value="">Failed to load models</option>';
      const sessModelEl = document.getElementById('sessModel');
      if (sessModelEl) sessModelEl.innerHTML = '<option value="">Failed</option>';
    }
  }

  // Start exploration
  exploreStartBtn.addEventListener('click', async () => {
    const model = exploreModel.value;
    const task = exploreTask.value.trim();
    if (!task) return;

    // Reset UI
    exploreRunning = true;
    setGlobalLock(true);
    exploreStartBtn.disabled = true;
    exploreCancelBtn.disabled = false;
    exploreTrajectoryId.textContent = '';
    exploreTimeline.innerHTML = '';
    exploreLogTerminal.innerHTML = '';
    exploreLog('system', 'Starting exploration...');

    exploreStep('init', 'running', 'Starting Browser Use Agent', 'Task: ' + task.slice(0, 100));

    exploreAbortController = new AbortController();

    try {
      const response = await fetch('/api/browser-use/explore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, task }),
        signal: exploreAbortController.signal,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'HTTP ' + response.status }));
        exploreLog('error', err.error || 'Request failed');
        exploreStatus.textContent = 'Failed';
        exploreRunning = false;
        setGlobalLock(false);
        exploreStartBtn.disabled = false;
        exploreCancelBtn.disabled = true;
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const parseSSE = (text) => {
        const lines = text.split('\n');
        let eventType = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith('data: ') && eventType) {
            try {
              const data = JSON.parse(line.slice(6));
              handleSSEEvent(eventType, data);
            } catch (e) {}
            eventType = '';
          }
        }
      };

      const handleSSEEvent = (type, data) => {
        switch (type) {
          case 'status':
            exploreStatus.textContent = data.label;
            if (data.phase === 'explore_done') {
              exploreStep('init', 'success', 'Exploration complete', (data.steps || '') + ' steps recorded');
            }
            if (data.phase === 'workflow' && data.currentPhase) {
              exploreStep('phase-' + data.currentPhase, 'running', 'Phase ' + data.currentPhase + '/' + data.totalPhases, data.label.replace(/^.*?: /, ''));
            }
            if (data.phase === 'error') {
              exploreStep('error', 'error', 'Error', data.label);
            }
            break;

          case 'step':
            const stepId = 'browser-step-' + data.step;
            const actions = (data.actions || []).join(', ');
            exploreStep(stepId, 'running', 'Step ' + data.step, actions ? 'Actions: ' + actions : data.next_goal || '');
            exploreLog('info', 'Step ' + data.step + ': ' + (data.next_goal || actions || 'thinking...'));
            exploreStatus.textContent = 'Step ' + data.step + ': ' + data.next_goal;
            break;

          case 'phase_start':
            exploreLog('system', '▶ Phase ' + data.phase + '/' + data.total + ': ' + data.name);
            exploreStep('phase-' + data.phase, 'running', 'Phase ' + data.phase + '/' + data.total, data.name);
            break;

          case 'phase_done':
            exploreLog('success', '✓ Phase ' + data.phase + '/' + data.total + ' done: ' + data.name);
            exploreStep('phase-' + data.phase, 'success', '✓ Phase ' + data.phase + '/' + data.total, data.name);
            break;

          case 'phase_error':
            exploreLog('error', '✗ Phase ' + data.phase + ' failed: ' + (data.message || ''));
            exploreStep('phase-' + data.phase, 'error', '✗ Phase ' + data.phase + ' failed', data.message || '');
            break;

          case 'workflow_done':
            exploreLog('system', 'All ' + data.total_phases + ' phases completed');
            exploreStep('wf-done', 'success', 'Workflow complete', data.total_phases + ' phases executed');
            break;

          case 'trajectory':
            exploreTrajectoryId.textContent = 'A:' + (data.action_file || '').split(/[\\/]/).pop() || '';
            exploreLog('system', 'Actions: ' + (data.action_count || '?') + ', Log: ' + (data.log_count || '?') + ' lines');
            exploreStep('traj', 'success', 'Trajectory saved', data.action_count + ' actions + ' + data.log_count + ' log lines');
            break;

          case 'done':
            exploreRunning = false;
            setGlobalLock(false);
            exploreStartBtn.disabled = false;
            exploreCancelBtn.disabled = true;

            if (data.success && data.action_file) {
              exploreTrajectoryId.textContent = 'Saved: ' + data.action_file.split(/[\\/]/).pop();
              exploreStatus.textContent = 'Exploration complete';
              exploreLog('success', 'Actions: ' + data.action_count + ', Log: ' + data.log_count);
            } else if (data.success && data.phase === 'explore_only') {
              exploreStatus.textContent = data.message || 'Complete';
              exploreLog('success', data.message || 'All phases done');
            } else {
              exploreStatus.textContent = 'Failed';
              exploreLog('error', data.message || 'Exploration failed');
            }
            break;

          case 'error':
            const msg = data.message || 'Unknown error';
            exploreLog('error', msg);
            exploreStatus.textContent = 'Error: ' + msg.slice(0, 40);
            if (exploreRunning) {
              exploreRunning = false;
              exploreStartBtn.disabled = false;
              exploreCancelBtn.disabled = true;
            }
            break;
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!exploreRunning) { reader.cancel(); break; }

        buffer += decoder.decode(value, { stream: true });
        // Process complete SSE frames (separated by \n\n)
        const parts = buffer.split('\n\n');
        buffer = parts.pop(); // keep incomplete last part

        for (const part of parts) {
          if (part.trim()) parseSSE(part + '\n');
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') return; // user cancelled
      exploreLog('error', err.message);
      exploreStatus.textContent = 'Connection error';
      if (exploreRunning) {
        exploreRunning = false;
        exploreStartBtn.disabled = false;
        exploreCancelBtn.disabled = true;
      }
    }
  });

  // Cancel
  exploreCancelBtn.addEventListener('click', () => {
    if (exploreAbortController) {
      exploreAbortController.abort();
      exploreAbortController = null;
    }
    exploreRunning = false;
    setGlobalLock(false);
    exploreStartBtn.disabled = false;
    exploreCancelBtn.disabled = true;
    exploreStatus.textContent = 'Cancelled';
    exploreLog('system', 'Exploration cancelled by user');
  });

  // Clear log button
  document.getElementById('exploreClearLogBtn').addEventListener('click', () => {
    if (exploreLogTerminal) exploreLogTerminal.innerHTML = '<div class="log-line system"><span class="ts">⚡</span>Cleared</div>';
  });

  // Load models on page load
  if (exploreModel) loadExploreModels();
}
