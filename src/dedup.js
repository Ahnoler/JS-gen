/**
 * Deduplicate action entries by (action + params).
 *
 * Only removes CONSECUTIVE duplicates — identical entries that appear
 * back-to-back with no different-type action between them.
 * Does NOT remove non-consecutive duplicates (e.g. same fill before
 * and after a click), because they represent different semantic steps.
 */

function dedupKey(entry) {
  const action = entry?.action || '';
  const params = entry?.params || {};
  const sorted = Object.keys(params).sort().reduce((acc, k) => {
    acc[k] = params[k];
    return acc;
  }, {});
  return action + '|' + JSON.stringify(sorted);
}

export function deduplicateByXPath(entries) {
  if (!entries || !Array.isArray(entries)) return [];
  const result = [];
  for (let i = 0; i < entries.length; i++) {
    if (i > 0 && dedupKey(entries[i - 1]) === dedupKey(entries[i])) {
      continue; // skip consecutive duplicate
    }
    result.push(entries[i]);
  }
  return result;
}

export function deduplicateActionFile(jsonContent) {
  const data = typeof jsonContent === 'string' ? JSON.parse(jsonContent) : jsonContent;
  const commands = (data?.tests?.[0]?.commands) || data?.actions || [];
  const deduped = deduplicateByXPath(commands);
  if (data?.tests?.[0]) {
    data.tests[0].commands = deduped;
  } else if (data?.actions) {
    data.actions = deduped;
  } else {
    data.tests = [{ id: 't1', name: 'session', commands: deduped }];
  }
  return {
    ...data,
    _meta: {
      originalCount: commands.length,
      dedupedCount: deduped.length,
      removedCount: commands.length - deduped.length,
    },
  };
}
