export function assertNumericPhaseIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new Error('phaseIds must be database numeric ids');
  }
  return ids.map((id) => {
    const text = String(id);
    const n = Number(id);
    if (text.includes('-') || !Number.isInteger(n)) {
      throw new Error('phaseIds must be database numeric ids, not UUIDs');
    }
    return n;
  });
}

export function cdpPortFromPrepare(prepareData, slotIndex) {
  const fromPrepare = Number(prepareData?.stages?.browser?.cdpPort);
  if (Number.isInteger(fromPrepare) && fromPrepare > 0) return fromPrepare;
  if (slotIndex == null) {
    throw new Error('cdp port missing: no prepare cdpPort and no slotIndex');
  }
  const slot = Number(slotIndex);
  if (!Number.isInteger(slot) || slot < 0) {
    throw new Error('cdp port missing: no prepare cdpPort and no slotIndex');
  }
  return 19242 + slot;
}
