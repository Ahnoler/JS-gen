/* global document, requestAnimationFrame */

/**
 * Strip slot/session prefix from a stderr log line (same rules as agent-stderr-log-service).
 * @param {string} line raw line
 * @returns {string} line without leading slot/session tag
 */
function stripLinePrefix(line) {
  let s = String(line)
    .replace(/^\[slot:\d+\s+sid:[a-z0-9]+\]\s?/, '');
  s = s.replace(/^\[session(?:\s+[^\]]*)?\]\s?/, '');
  return s;
}

/**
 * Derive step card status from step fields.
 * @param {boolean} done whether the step ended with done=yes
 * @param {boolean} stopped whether the step ended with stopped=yes
 * @param {string} act serialized action payload from the log line
 * @param {string} res result text from the log line
 * @param {string} err error text from the log line
 * @returns {'fail'|'done'|'empty'|'ok'} UI status derived from fields
 */
export function stepStatus(done, stopped, act, res, err) {
  if (String(err).length > 0 || stopped) {
    return 'fail';
  }
  if (done) {
    return 'done';
  }
  if (act === '' || act === '{}' || act === '-' || res === 'None') {
    return 'empty';
  }
  return 'ok';
}

const PHASE_RE = /^Phase (\d+): (.*) \(max_steps=\d+\)$/;
const REPLAY_ACTION_RE = /^\[replay\] \[(\d+\/\d+)\] (\S+)(?: (.*))?$/;
const REPLAY_INDEXED_RE = /^\[replay\] \[(\d+\/\d+)\] (.*)$/;
const STEP_HEADER_RE = /^\[step (\d+)\] done=(yes|no) stopped=(yes|no) \| goal=(.*)$/;

/**
 * @param {string} dictStr Python-style dict fragment after the action name
 * @param {string} key key to read
 * @returns {string|null} quoted value for key, or null when absent
 */
function pyDictString(dictStr, key) {
  if (!dictStr) {
    return null;
  }
  const m = dictStr.match(new RegExp(`'${key}':\\s*'([^']*)'`));
  return m ? m[1] : null;
}

/**
 * @param {string} operation replay action name
 * @param {string} [paramsStr] trailing param dict text
 * @returns {string} human goal text
 */
function replayGoal(operation, paramsStr) {
  const url = pyDictString(paramsStr, 'url');
  if (operation === 'go_to_url' && url) {
    return `打开 ${url}`;
  }
  const label = pyDictString(paramsStr, 'label_text');
  if (operation === 'fill_form_field' && label) {
    return `填写「${label}」`;
  }
  const text = pyDictString(paramsStr, 'text');
  if (text && operation.startsWith('click')) {
    return `点击「${text}」`;
  }
  return operation;
}

/**
 * @param {string} s source string
 * @param {number} start index of opening quote
 * @returns {{ value: string, next: number }} decoded string and index after closing quote
 */
function readJsonStringAt(s, start) {
  let i = start + 1;
  while (i < s.length) {
    if (s[i] === '\\') {
      i += 2;
      continue;
    }
    if (s[i] === '"') {
      const value = JSON.parse(s.slice(start, i + 1));
      return { value, next: i + 1 };
    }
    i++;
  }
  throw new Error('unterminated JSON string');
}

/**
 * @param {string} rest substring after `goal=`
 * @returns {{ goal: string, act: string, res: string, err: string }} parsed step fields
 */
function parseJsonStepFields(rest) {
  let pos = 0;
  const goal = readJsonStringAt(rest, pos);
  pos = goal.next;

  const readField = (sep) => {
    if (!rest.startsWith(sep, pos)) {
      return null;
    }
    pos += sep.length;
    return readJsonStringAt(rest, pos);
  };

  const act = readField(' | act=');
  if (!act) {
    throw new Error('missing act');
  }
  pos = act.next;

  const res = readField(' | res=');
  if (!res) {
    throw new Error('missing res');
  }
  pos = res.next;

  let err = '';
  const errField = readField(' | err=');
  if (errField) {
    err = errField.value;
  }

  return { goal: goal.value, act: act.value, res: res.value, err };
}

/**
 * @param {string} line stripped step line
 * @returns {object|null} step block
 */
function parseStepLine(line) {
  const m = line.match(STEP_HEADER_RE);
  if (!m) {
    return null;
  }
  const step = Number(m[1]);
  const done = m[2] === 'yes';
  const stopped = m[3] === 'yes';
  const rest = m[4];

  let goal;
  let act;
  let res;
  let err;

  if (rest.startsWith('"')) {
    try {
      ({ goal, act, res, err } = parseJsonStepFields(rest));
    } catch {
      return null;
    }
  } else {
    const actIdx = rest.indexOf(' | act=');
    if (actIdx === -1) {
      return null;
    }
    goal = rest.slice(0, actIdx);
    const afterAct = rest.slice(actIdx + ' | act='.length);
    const resIdx = afterAct.indexOf(' | res=');
    if (resIdx === -1) {
      return null;
    }
    act = afterAct.slice(0, resIdx);
    const afterRes = afterAct.slice(resIdx + ' | res='.length);
    const errIdx = afterRes.indexOf(' | err=');
    if (errIdx === -1) {
      res = afterRes;
      err = '';
    } else {
      res = afterRes.slice(0, errIdx);
      err = afterRes.slice(errIdx + ' | err='.length);
    }
  }

  return {
    kind: 'step',
    step,
    done,
    stopped,
    goal,
    act,
    res,
    err,
    status: stepStatus(done, stopped, act, res, err),
    raw: line,
  };
}

/**
 * @param {string} line stripped card line
 * @returns {object|null} info block, malformed-card other stub, or null when not a card line
 */
function parseCardLine(line) {
  if (!line.startsWith('[card] ')) {
    return null;
  }
  const jsonText = line.slice('[card] '.length);
  try {
    const data = JSON.parse(jsonText);
    return {
      kind: 'info',
      cardKind: String(data.kind ?? ''),
      phase: data.phase ?? null,
      title: String(data.title ?? ''),
      score: data.score ?? null,
      text: String(data.text ?? ''),
    };
  } catch {
    return { kind: 'other', lines: [line] };
  }
}

/**
 * Parse agent stderr text into renderable log blocks.
 * @param {string} text full log file contents
 * @returns {Array<object>} ordered blocks (phase, info, step, replay, other)
 */
export function parseAgentLog(text) {
  const lines = String(text).split(/\r?\n/);
  const blocks = [];
  const otherBuffer = [];
  /** @type {Map<string, { operation: string, params: string, rawAction: string, goal: string }>} */
  const pendingReplay = new Map();

  const flushOther = () => {
    if (otherBuffer.length > 0) {
      blocks.push({ kind: 'other', lines: otherBuffer.splice(0) });
    }
  };

  const emitReplay = (index, pending, result, status) => {
    blocks.push({
      kind: 'replay',
      index,
      goal: pending.goal,
      operation: pending.operation,
      result,
      status,
      raw: result ? `${pending.rawAction}\n[replay] [${index}] ${result}` : pending.rawAction,
    });
  };

  for (const rawLine of lines) {
    const line = stripLinePrefix(rawLine);

    if (line.startsWith('[card] ')) {
      flushOther();
      const card = parseCardLine(line);
      if (card.kind === 'other') {
        otherBuffer.push(...card.lines);
      } else {
        blocks.push(card);
      }
      continue;
    }

    const phaseMatch = line.match(PHASE_RE);
    if (phaseMatch) {
      flushOther();
      blocks.push({
        kind: 'phase',
        phase: Number(phaseMatch[1]),
        title: phaseMatch[2],
      });
      continue;
    }

    const stepBlock = parseStepLine(line);
    if (stepBlock) {
      flushOther();
      blocks.push(stepBlock);
      continue;
    }

    const indexedReplay = line.match(REPLAY_INDEXED_RE);
    if (indexedReplay) {
      const index = indexedReplay[1];
      const body = indexedReplay[2];
      if (pendingReplay.has(index)) {
        flushOther();
        const pending = pendingReplay.get(index);
        pendingReplay.delete(index);
        const status = /^OK →/.test(body) ? 'ok' : 'fail';
        emitReplay(index, pending, body, status);
        continue;
      }
      const actionMatch = line.match(REPLAY_ACTION_RE);
      if (actionMatch && actionMatch[2] !== 'OK') {
        flushOther();
        const operation = actionMatch[2];
        const params = actionMatch[3] ?? '';
        pendingReplay.set(index, {
          operation,
          params,
          rawAction: line,
          goal: replayGoal(operation, params),
        });
        continue;
      }
    }

    otherBuffer.push(line);
  }

  flushOther();

  for (const [index, pending] of pendingReplay) {
    emitReplay(index, pending, '', 'fail');
  }

  return blocks;
}

/** @type {WeakMap<object, { blocks: object[], rawText: string }>} */
const renderStore = new WeakMap();

/**
 * Escape HTML for safe text interpolation.
 * @param {string} str raw string
 * @returns {string} escaped HTML
 */
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * First line of multiline text.
 * @param {string} s source
 * @returns {string} first line
 */
function firstLine(s) {
  const i = String(s).indexOf('\n');
  return i === -1 ? String(s) : String(s).slice(0, i);
}

/**
 * Short label for step action JSON on card face.
 * @param {string} act serialized action
 * @returns {string} human-readable operation
 */
function formatStepAct(act) {
  const raw = String(act ?? '');
  if (!raw || raw === '{}' || raw === '-') {
    return '—';
  }
  try {
    const o = JSON.parse(raw);
    const keys = Object.keys(o);
    if (!keys.length) {
      return '—';
    }
    const name = keys[0];
    const params = o[name];
    if (name === 'click_element_by_index' && params && params.index != null) {
      return `点击元素 ${params.index}`;
    }
    if (name === 'fill_form_field' && params && params.label_text) {
      return `填写「${params.label_text}」`;
    }
    return name;
  } catch {
    return raw.length > 120 ? `${raw.slice(0, 120)}…` : raw;
  }
}

/**
 * Full modal body text for a parsed block.
 * @param {object} block parseAgentLog block
 * @returns {string} modal pre content
 */
function modalBodyForBlock(block) {
  if (block.kind === 'step') {
    return [
      `目标:\n${block.goal}`,
      `操作:\n${block.act}`,
      `结果:\n${block.res}`,
      `错误:\n${block.err}`,
    ].join('\n\n');
  }
  if (block.kind === 'info') {
    const head = block.title ? `${block.title}\n\n` : '';
    return head + block.text;
  }
  if (block.kind === 'replay') {
    return block.raw || `${block.goal}\n${block.result}`;
  }
  return (block.lines || []).join('\n');
}

/** @type {object|null} */
let sharedModal = null;

/**
 * Ensure the singleton log detail modal exists on document.body.
 * @returns {object} modal root element
 */
function ensureModal() {
  if (sharedModal) {
    return sharedModal;
  }
  sharedModal = document.createElement('div');
  sharedModal.className = 'ops-modal';
  sharedModal.innerHTML = `
    <div class="ops-modal-backdrop"></div>
    <div class="ops-modal-dialog" role="dialog" aria-modal="true">
      <button type="button" class="btn ops-modal-close">关闭</button>
      <pre class="ops-modal-body"></pre>
    </div>
  `;
  const close = () => sharedModal?.classList.remove('open');
  sharedModal.querySelector('.ops-modal-backdrop')?.addEventListener('click', close);
  sharedModal.querySelector('.ops-modal-close')?.addEventListener('click', close);
  document.body.appendChild(sharedModal);
  return sharedModal;
}

/**
 * Open the shared modal with full card text.
 * @param {string} body preformatted body
 * @returns {void}
 */
function openLogModal(body) {
  const modal = ensureModal();
  const pre = modal.querySelector('.ops-modal-body');
  if (pre) {
    pre.textContent = body;
  }
  modal.classList.add('open');
}

/**
 * Build one ellipsis line for card face.
 * @param {string} label face label
 * @param {string} value face value
 * @returns {string} HTML snippet
 */
function faceLine(label, value) {
  return `<span class="ops-card-line"><span class="ops-card-label">${escapeHtml(label)}</span> ${escapeHtml(value)}</span>`;
}

/**
 * Render parsed stderr into card buttons inside container; reuse one modal.
 * @param {object} container scrollable log host element
 * @param {string} text raw stderr string (also used for copy-full)
 * @param {{ stickToBottom: boolean }} state follow-bottom flag (mutated on scroll)
 * @returns {void}
 */
export function renderLogCards(container, text, state) {
  const blocks = parseAgentLog(text);
  renderStore.set(container, { blocks, rawText: text });

  const parts = [];
  blocks.forEach((block, idx) => {
    if (block.kind === 'phase') {
      parts.push(
        `<h3 class="ops-phase-title">Phase ${block.phase}: ${escapeHtml(block.title)}</h3>`,
      );
      return;
    }
    if (block.kind === 'other') {
      const joined = (block.lines || []).join('\n');
      parts.push(
        `<details class="ops-other"><summary>其他（${block.lines?.length || 0} 行）</summary>`
        + `<pre class="ops-other-pre">${escapeHtml(joined)}</pre></details>`,
      );
      return;
    }
    if (block.kind === 'info') {
      const kb = block.cardKind === 'kb' ? ' ops-card-kb' : '';
      const face = block.cardKind === 'kb' && block.score != null
        ? `${escapeHtml(block.title)} · score ${block.score}`
        : `${escapeHtml(block.title)} · ${escapeHtml(firstLine(block.text))}`;
      parts.push(
        `<button type="button" class="ops-card ops-card-info${kb}" data-block-idx="${idx}">`
        + `<span class="ops-card-face">${face}</span></button>`,
      );
      return;
    }
    if (block.kind === 'step') {
      const st = block.status;
      parts.push(
        `<button type="button" class="ops-card ops-card-${st}" data-block-idx="${idx}">`
        + `<span class="ops-card-face">`
        + faceLine('目标', block.goal)
        + faceLine('操作', formatStepAct(block.act))
        + faceLine('结果', firstLine(block.res))
        + `</span></button>`,
      );
      return;
    }
    if (block.kind === 'replay') {
      const st = block.status;
      parts.push(
        `<button type="button" class="ops-card ops-card-${st}" data-block-idx="${idx}">`
        + `<span class="ops-card-face">`
        + faceLine('目标', block.goal)
        + faceLine('操作', block.operation)
        + faceLine('结果', firstLine(block.result || '—'))
        + `</span></button>`,
      );
    }
  });

  container.innerHTML = parts.join('');

  if (!container.dataset.opsLogBound) {
    container.dataset.opsLogBound = '1';
    container.addEventListener('scroll', () => {
      const dist = container.scrollHeight - container.scrollTop - container.clientHeight;
      state.stickToBottom = dist <= 24;
    });
    container.addEventListener('click', (e) => {
      const card = e.target.closest('[data-block-idx]');
      if (!card) {
        return;
      }
      const store = renderStore.get(container);
      const i = Number(card.dataset.blockIdx);
      const block = store?.blocks?.[i];
      if (!block) {
        return;
      }
      openLogModal(modalBodyForBlock(block));
    });
  }

  if (state.stickToBottom) {
    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
  }
}

