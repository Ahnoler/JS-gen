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
 * @param {boolean} done
 * @param {boolean} stopped
 * @param {string} act
 * @param {string} res
 * @param {string} err
 * @returns {'fail'|'done'|'empty'|'ok'}
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
 * @returns {string|null}
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
 * @returns {{ value: string, next: number }}
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
 * @returns {{ goal: string, act: string, res: string, err: string }}
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
 * @returns {object|null}
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
