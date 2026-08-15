import * as sysMsgService from '../../services/sys-msg/sys-msg-service.js';

function statusOf(err) {
  return err?.statusCode || 500;
}

export default function registerMessages(app) {
  app.get('/api/v2/messages/unread-count', async (req, res) => {
    try {
      const data = await sysMsgService.getUnreadCount();
      res.json(data);
    } catch (err) {
      res.status(statusOf(err)).json({ error: err.message });
    }
  });

  app.post('/api/v2/messages/read-all', async (req, res) => {
    try {
      const data = await sysMsgService.markAllMessagesRead();
      res.json(data);
    } catch (err) {
      res.status(statusOf(err)).json({ error: err.message });
    }
  });

  app.post('/api/v2/messages/:id/read', async (req, res) => {
    try {
      const data = await sysMsgService.markMessageRead(req.params.id);
      res.json(data);
    } catch (err) {
      res.status(statusOf(err)).json({ error: err.message });
    }
  });

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
