/**
 * L1c region classify — shared by resolve-element and scan/fullpage consumers.
 */
import { classifyRegions } from '../../services/region-classify.js';
import { sendErr, asyncHandler } from './trajectory-shared.js';

export default function registerRegions(app) {
  app.post('/api/v2/regions/classify', asyncHandler(async (req, res) => {
    const cards = Array.isArray(req.body?.cards) ? req.body.cards : [];
    const systemId = req.body?.systemId ?? req.body?.system_id ?? '';
    const items = await classifyRegions(cards, { systemId });
    res.json({ items });
  }));
}
