export default function (app) {
  app.get('/api/agent/execute-stream', (req, res) => {
    res.status(501).json({ error: 'SSE streaming not available in standalone mode. Use /v1/chat/completions or /api/agent/execute instead.' });
  });
}
