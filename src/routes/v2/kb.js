import { asyncHandler } from '../../http/app-error.js';
import { listFlowCards } from '../../services/kb-flow-cards.js';
import { detectStaleCards } from '../../services/change-impact-service.js';
import * as systemDao from '../../dao/system-dao.js';

/**
 * KB insights routes: flow-card listing (with source_refs provenance) and
 * read-only possibly-stale detection against the current hierarchy tree.
 *
 * Prefix: /api/v2/kb/*
 * @param {import('express').Application} app Express application
 */
export default function registerKbRoutes(app) {
  /** GET /api/v2/kb/cards — 全部流程卡消费侧字段（含 source/source_refs 溯源）。 */
  app.get('/api/v2/kb/cards', asyncHandler(async (req, res) => {
    res.json(await listFlowCards());
  }));

  /** GET /api/v2/kb/stale-cards — menu_path 对当前树三态解析（只读，不写卡）。 */
  app.get('/api/v2/kb/stale-cards', asyncHandler(async (req, res) => {
    const [cards, flatNodes] = await Promise.all([listFlowCards(), systemDao.listAll()]);
    res.json(detectStaleCards(cards, flatNodes));
  }));
}
