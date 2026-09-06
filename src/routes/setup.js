import path from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync } from 'fs';
import { PROJECT_DIR, LLM_BASE_URL as CFG_LLM_BASE_URL, LLM_MODEL, FORM_LLM_MODEL, FORM_LLM_BASE_URL } from '#config/config.js';
import { setupConfig, isConfigured } from '../state.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

/**
 * First-launch setup routes, root redirect, product API docs page, and
 * legacy engineering UI 301 redirects.
 * @param {import('express').Application} app Express application
 */
export default function registerSetupRoutes(app) {
  // Serve the setup page
  app.get('/api/setup', (req, res) => {
    res.sendFile(path.join(PROJECT_DIR, 'config', 'setup.html'));
  });

  // Save config from setup form (loopback-only: this endpoint overwrites .env)
  app.post('/api/setup/save', (req, res) => {
    const remoteAddr = req.socket.remoteAddress || '';
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remoteAddr)) {
      return res.status(403).json({ ok: false, error: '仅允许本机回环访问配置接口' });
    }
    const { LLM_API_KEY: key, LLM_BASE_URL: url, FORM_LLM_MODEL: model } = req.body || {};
    if (!key || !key.trim()) {
      return res.status(400).json({ ok: false, error: 'API Key 不能为空' });
    }
    const envPath = path.join(PROJECT_DIR, 'config', '.env');
    const lines = [];
    lines.push('# ───────────────────────────────────────');
    lines.push('# 智能填表系统 — 运行配置');
    lines.push('# ───────────────────────────────────────');
    lines.push('');
    lines.push('# 服务器');
    lines.push('PORT=4097');
    lines.push('HOST=0.0.0.0');
    lines.push('');
    lines.push('# LLM 连接');
    lines.push(`LLM_BASE_URL=${url || CFG_LLM_BASE_URL}`);
    lines.push(`LLM_MODEL=${model || LLM_MODEL}`);
    lines.push(`LLM_API_KEY=${key.trim()}`);
    lines.push('');
    lines.push('# 表单填写 LLM（可选用更便宜的模型）');
    lines.push(`FORM_LLM_MODEL=${model || FORM_LLM_MODEL}`);
    lines.push(`FORM_LLM_BASE_URL=${url || FORM_LLM_BASE_URL}`);
    lines.push(`FORM_LLM_API_KEY=${key.trim()}`);
    lines.push('');
    lines.push('# Python 解释器路径（留空则自动查找）');
    lines.push('# PYTHON_EXE=');
    lines.push('');
    lines.push('# 项目根目录（留空则自动检测）');
    lines.push('# PROJECT_DIR=');
    try {
      writeFileSync(envPath, lines.join('\n'), 'utf-8');
      setupConfig.apiKey = key.trim();            // update runtime state
      console.log('[server] API Key saved via setup page');
      res.json({ ok: true });
    } catch (e) {
      console.error('[server] Failed to save .env:', e.message);
      res.status(500).json({ ok: false, error: '写入配置文件失败: ' + e.message });
    }
  });

  // Redirect root to product API docs, or setup if unconfigured
  app.get('/', (req, res) => {
    res.redirect(isConfigured() ? '/api/docs' : '/api/setup');
  });

  // API key status check (used by setup / clients to detect unconfigured state)
  app.get('/api/setup/status', (req, res) => {
    res.json({ configured: isConfigured() });
  });

  /** Product API docs for frontend (Swagger-like, /api/v2 + WebSocket) */
  app.get('/api/docs', (req, res) => {
    res.sendFile(path.join(PROJECT_ROOT, 'api-docs.html'));
  });

  // Legacy engineering UI pages removed (product SPA lives outside this repo).
  // Keep /api/test/assemble|run|…; only these HTML entry routes redirect.
  app.get(['/api/test', '/api/test/record-console', '/api/test/record-studio'], (req, res) => {
    res.redirect(301, '/api/docs');
  });
}
