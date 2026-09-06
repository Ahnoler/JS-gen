import * as sysMsgService from '../../services/sys-msg/sys-msg-service.js';
import { asyncHandler } from '../../http/app-error.js';

/**
 * System message (notification) APIs — unread count, list, mark-read.
 *
 * Prefix: /api/v2/messages/*
 */

/**
 * Register system-message routes.
 * @param {import('express').Application} app Express application
 */
export default function registerMessages(app) {
  /** Get the current user's unread message count. */
  app.get('/api/v2/messages/unread-count', asyncHandler(async (req, res) => {
    const data = await sysMsgService.getUnreadCount();
    res.json(data);
  }));

  /** Mark all messages as read. */
  app.post('/api/v2/messages/read-all', asyncHandler(async (req, res) => {
    const data = await sysMsgService.markAllMessagesRead();
    res.json(data);
  }));

  /** Mark a single message as read. */
  app.post('/api/v2/messages/:id/read', asyncHandler(async (req, res) => {
    const data = await sysMsgService.markMessageRead(req.params.id);
    res.json(data);
  }));

  /** List messages (paginated). */
  app.get('/api/v2/messages', asyncHandler(async (req, res) => {
    const data = await sysMsgService.listMessages({
      pageNum: req.query.pageNum,
      pageSize: req.query.pageSize,
    });
    res.json(data);
  }));
}
