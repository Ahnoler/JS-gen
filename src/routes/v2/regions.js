/**
 * L1c region classify — shared by resolve-element and scan/fullpage consumers.
 */
import { classifyRegions } from '../../services/region-classify.js';

function sendErr(res, err) {
  const code = err.statusCode || 500;
  return res.status(code).json({ error: err.message });
}

export default function registerRegions(app) {
  app.post('/api/v2/regions/classify', async (req, res) => {
    try {
      const cards = Array.isArray(req.body?.cards) ? req.body.cards : [];
      const systemId = req.body?.systemId ?? req.body?.system_id ?? '';
      const items = await classifyRegions(cards, { systemId });
      res.json({ items });
    } catch (err) {
      sendErr(res, err);
    }
  });
}
