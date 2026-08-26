import * as sysMsgService from '../../services/sys-msg/sys-msg-service.js';

/**
 * System message (notification) APIs — unread count, list, mark-read.
 *
 * Prefix: /api/v2/messages/*
 */

function statusOf(err) {
  return err?.statusCode || 500;
}

/**
 * Register system-message routes.
 * @param {import('express').Application} app Express application
 */
export default function registerMessages(app) {
  /** Get the current user's unread message count. */
  app.get('/api/v2/messages/unread-count', async (req, res) => {
    try {
      const data = await sysMsgService.getUnreadCount();
      res.json(data);
    } catch (err) {
      res.status(statusOf(err)).json({ error: err.message });
    }
  });

  /** Mark all messages as read. */
  app.post('/api/v2/messages/read-all', async (req, res) => {
    try {
      const data = await sysMsgService.markAllMessagesRead();
      res.json(data);
    } catch (err) {
      res.status(statusOf(err)).json({ error: err.message });
    }
  });

  /** Mark a single message as read. */
  app.post('/api/v2/messages/:id/read', async (req, res) => {
    try {
      const data = await sysMsgService.markMessageRead(req.params.id);
      res.json(data);
    } catch (err) {
      res.status(statusOf(err)).json({ error: err.message });
    }
  });

  /** List messages (paginated). */
  app.get('/api/v2/messages', async (req, res) => {
    try {
      const data = await sysMsgService.listMessages({
        pageNum: req.query.pageNum,
        pageSize: req.query.pageSize,
      });
      res.json(data);
    } catch (err) {
      res.status(statusOf(err)).json({ error: err.message });
    }
  });
}
