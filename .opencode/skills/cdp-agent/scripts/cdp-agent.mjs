import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import http from 'http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LIB_DIR = resolve(__dirname, 'lib');

let _msgId = 1;

export class CDPAgent {
  constructor() {
    this.ws = null;
    this.connected = false;
    this.pages = [];
    this.pageSessions = new Map();
    this.actions = [];
    this.helpersInjected = new Set();
  }

  async discover(host, port = 9222) {
    const url = `http://${host}:${port}/json/version`;
    return new Promise((resolve, reject) => {
      const req = http.get(url, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const info = JSON.parse(data);
            resolve(info.webSocketDebuggerUrl);
          } catch (e) {
            reject(new Error(`解析 CDP 信息失败: ${e.message}`));
          }
        });
      });
      req.on('error', reject);
      req.setTimeout(5000, () => { req.destroy(); reject(new Error('连接超时')); });
    });
  }

  async connect(host, port = 9222) {
    const wsUrl = await this.discover(host, port);
    if (!wsUrl) throw new Error('未发现 CDP WebSocket 地址');

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(wsUrl);
      this.ws.onopen = () => {
        this.connected = true;
        this._send({ method: 'Target.getTargets', id: _msgId++ });
      };
      this.ws.onmessage = async (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id && msg.result && msg.result.targetInfos) {
          this.pages = msg.result.targetInfos.filter(t => t.type === 'page');
          resolve({ ok: true, pages: this.pages.map(p => ({
            id: p.targetId, title: p.title, url: p.url, type: p.type
          })) });
        } else if (msg.id && msg.error) {
          reject(new Error(`CDP 错误: ${JSON.stringify(msg.error)}`));
        } else if (msg.method === 'Target.attachedToTarget') {
          const sessionId = msg.params.sessionId;
          const targetId = msg.params.targetInfo.targetId;
          this.pageSessions.set(targetId, sessionId);
          resolve({ ok: true, sessionId, targetId });
        } else if (msg.id && msg.result && msg.result.sessionId) {
          const sessionId = msg.result.sessionId;
          const targetId = msg.params?.targetId || msg.result.sessionId;
          this.pageSessions.set(targetId, sessionId);
          resolve({ ok: true, sessionId, targetId });
        }
      };
      this.ws.onerror = (err) => reject(err);
      this.ws.onclose = () => { this.connected = false; };
    });
  }

  async attachPage(targetId) {
    return new Promise((resolve, reject) => {
      const id = _msgId++;
      const handler = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id === id) {
          if (msg.result) {
            const sessionId = msg.result.sessionId;
            this.pageSessions.set(targetId, sessionId);
            this.ws.removeEventListener('message', handler);
            resolve({ ok: true, sessionId });
          } else if (msg.error) {
            this.ws.removeEventListener('message', handler);
            reject(new Error(`attachPage 失败: ${JSON.stringify(msg.error)}`));
          }
        }
      };
      this.ws.addEventListener('message', handler);
      this.ws.send(JSON.stringify({
        id, method: 'Target.attachToTarget',
        params: { targetId, flatten: true }
      }));
    });
  }

  _send(msg) {
    if (!this.ws || !this.connected) throw new Error('未连接到 CDP');
    this.ws.send(JSON.stringify(msg));
  }

  async evaluate(pageId, expression, awaitPromise = true) {
    const sessionId = this.pageSessions.get(pageId);
    if (!sessionId) throw new Error(`页面 ${pageId} 未附加会话`);

    return new Promise((resolve, reject) => {
      const id = _msgId++;
      const handler = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id === id && msg.sessionId === sessionId) {
          this.ws.removeEventListener('message', handler);
          if (msg.error) reject(new Error(`evaluate 失败: ${JSON.stringify(msg.error)}`));
          else resolve(msg.result);
        }
      };
      this.ws.addEventListener('message', handler);
      this.ws.send(JSON.stringify({
        id, method: 'Runtime.evaluate',
        params: {
          expression,
          awaitPromise,
          returnByValue: true
        },
        sessionId
      }));
    });
  }

  async callMethod(pageId, method, params = {}) {
    const sessionId = this.pageSessions.get(pageId);
    if (!sessionId) throw new Error(`页面 ${pageId} 未附加会话`);

    return new Promise((resolve, reject) => {
      const id = _msgId++;
      const handler = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id === id && msg.sessionId === sessionId) {
          this.ws.removeEventListener('message', handler);
          if (msg.error) reject(new Error(`${method} 失败: ${JSON.stringify(msg.error)}`));
          else resolve(msg.result);
        }
      };
      this.ws.addEventListener('message', handler);
      this.ws.send(JSON.stringify({
        id, method, params, sessionId
      }));
    });
  }

  async injectHelpers(pageId) {
    const files = ['smart-selector.js', 'element-business-name.js', 'xpath-helper.js'];
    for (const file of files) {
      if (this.helpersInjected.has(file)) continue;
      const fpath = resolve(LIB_DIR, file);
      if (!existsSync(fpath)) throw new Error(`未找到辅助库: ${file}`);
      const code = readFileSync(fpath, 'utf-8');
      await this.evaluate(pageId, code);
      this.helpersInjected.add(file);
    }
    return { ok: true, injected: files };
  }

  async snapshot(pageId) {
    await this.injectHelpers(pageId);

    const result = await this.evaluate(pageId, `
      (() => {
        const selector = 'input, button, select, textarea, a, [role="button"], [role="input"], [role="textbox"], [tabindex]:not([tabindex="-1"])';
        const elements = document.querySelectorAll(selector);
        const seen = new Set();
        return Array.from(elements).filter(el => {
          if (el.offsetParent === null && el.tagName !== 'INPUT' && el.tagName !== 'BUTTON') return false;
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return false;
          if (seen.has(el)) return false;
          seen.add(el);
          return true;
        }).map(el => {
          try {
            const label = typeof getChineseLabelByElement === 'function' ? getChineseLabelByElement(el) : '';
            const selector = typeof SmartSelector !== 'undefined' ? new SmartSelector(el).getSelector() : '';
            return {
              tag: el.tagName.toLowerCase(),
              type: el.type || '',
              label: label || '',
              xpath: selector || '',
              visible: el.offsetParent !== null,
              value: (el.value || '').substring(0, 100),
              text: (el.textContent || '').trim().substring(0, 100),
              placeholder: el.getAttribute('placeholder') || '',
              rect: { width: Math.round(rect.width), height: Math.round(rect.height), top: Math.round(rect.top), left: Math.round(rect.left) }
            };
          } catch(e) {
            return null;
          }
        }).filter(Boolean);
      })()
    `);

    return result?.result || result?.value || [];
  }

  async getElementInfo(pageId, xpath) {
    await this.injectHelpers(pageId);

    const result = await this.evaluate(pageId, `
      (() => {
        try {
          const el = typeof XPathHelper !== 'undefined'
            ? XPathHelper.$(${JSON.stringify(xpath)})
            : document.evaluate(${JSON.stringify(xpath)}, document).iterateNext();

          if (!el) return { exists: false };

          const label = typeof getChineseLabelByElement === 'function' ? getChineseLabelByElement(el) : '';
          const selector = typeof SmartSelector !== 'undefined' ? new SmartSelector(el).getSelector() : '';

          return {
            exists: true,
            tag: el.tagName.toLowerCase(),
            type: el.type || '',
            label: label || '',
            xpath: selector || xpath,
            text: (el.textContent || '').trim().substring(0, 200),
            value: (el.value || ''),
            placeholder: el.getAttribute('placeholder') || '',
            visible: el.offsetParent !== null,
            attributes: Array.from(el.attributes).map(a => ({ name: a.name, value: a.value.substring(0, 100) }))
          };
        } catch(e) {
          return { exists: false, error: e.message };
        }
      })()
    `);

    return result?.result || result?.value || { exists: false };
  }

  async click(pageId, xpath) {
    await this.injectHelpers(pageId);

    const result = await this.evaluate(pageId, `
      (() => {
        try {
          const el = typeof XPathHelper !== 'undefined'
            ? XPathHelper.$(${JSON.stringify(xpath)})
            : document.evaluate(${JSON.stringify(xpath)}, document).iterateNext();

          if (!el) return { ok: false, error: '元素未找到' };

          const label = typeof getChineseLabelByElement === 'function' ? getChineseLabelByElement(el) || '' : '';
          const selector = typeof SmartSelector !== 'undefined' ? new SmartSelector(el).getSelector() : null;

          el.click();

          return {
            ok: true,
            action: {
              command: 'click',
              target: selector || xpath,
              targetType: 'xpath',
              tagName: el.tagName.toLowerCase(),
              propertiesName: label,
              value: '',
              timestamp: Date.now()
            }
          };
        } catch(e) {
          return { ok: false, error: e.message };
        }
      })()
    `);

    const data = result?.result || result?.value;
    if (data?.ok && data?.action) {
      this.actions.push(data.action);
    }
    return data;
  }

  async fill(pageId, xpath, value) {
    await this.injectHelpers(pageId);

    const result = await this.evaluate(pageId, `
      (() => {
        try {
          const el = typeof XPathHelper !== 'undefined'
            ? XPathHelper.$(${JSON.stringify(xpath)})
            : document.evaluate(${JSON.stringify(xpath)}, document).iterateNext();

          if (!el) return { ok: false, error: '元素未找到' };

          const label = typeof getChineseLabelByElement === 'function' ? getChineseLabelByElement(el) || '' : '';
          const selector = typeof SmartSelector !== 'undefined' ? new SmartSelector(el).getSelector() : null;

          el.focus();
          el.value = ${JSON.stringify(value)};
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.blur();

          return {
            ok: true,
            action: {
              command: 'input',
              target: selector || xpath,
              targetType: 'xpath',
              tagName: el.tagName.toLowerCase(),
              propertiesName: label,
              value: ${JSON.stringify(value)},
              timestamp: Date.now()
            }
          };
        } catch(e) {
          return { ok: false, error: e.message };
        }
      })()
    `);

    const data = result?.result || result?.value;
    if (data?.ok && data?.action) {
      this.actions.push(data.action);
    }
    return data;
  }

  async select(pageId, xpath, value) {
    await this.injectHelpers(pageId);

    const result = await this.evaluate(pageId, `
      (() => {
        try {
          const el = typeof XPathHelper !== 'undefined'
            ? XPathHelper.$(${JSON.stringify(xpath)})
            : document.evaluate(${JSON.stringify(xpath)}, document).iterateNext();

          if (!el) return { ok: false, error: '元素未找到' };

          const label = typeof getChineseLabelByElement === 'function' ? getChineseLabelByElement(el) || '' : '';
          const selector = typeof SmartSelector !== 'undefined' ? new SmartSelector(el).getSelector() : null;

          el.value = ${JSON.stringify(value)};
          el.dispatchEvent(new Event('change', { bubbles: true }));

          return {
            ok: true,
            action: {
              command: 'select',
              target: selector || xpath,
              targetType: 'xpath',
              tagName: el.tagName.toLowerCase(),
              propertiesName: label,
              value: ${JSON.stringify(value)},
              timestamp: Date.now()
            }
          };
        } catch(e) {
          return { ok: false, error: e.message };
        }
      })()
    `);

    const data = result?.result || result?.value;
    if (data?.ok && data?.action) {
      this.actions.push(data.action);
    }
    return data;
  }

  async screenshot(pageId) {
    const result = await this.callMethod(pageId, 'Page.captureScreenshot', { format: 'png' });
    if (result?.data) {
      return Buffer.from(result.data, 'base64');
    }
    throw new Error('截图失败');
  }

  async getSource(pageId) {
    const result = await this.evaluate(pageId, 'document.documentElement.outerHTML');
    return result?.result || '';
  }

  async navigate(pageId, url) {
    return this.callMethod(pageId, 'Page.navigate', { url });
  }

  getRecordedActions() {
    return [...this.actions];
  }

  toUploadJson(url) {
    function uuid() {
      const hex = "0123456789abcdef";
      const s = new Array(36);
      for (let i = 0; i < 36; i++) {
        s[i] = hex[Math.floor(Math.random() * 16)];
      }
      s[14] = "4";
      s[19] = hex[(s[19] & 0x3) | 0x8];
      s[8] = s[13] = s[18] = s[23] = "-";
      return s.join("");
    }

    return {
      id: uuid(),
      name: 'test',
      url: url || '',
      tests: [{
        id: uuid(),
        name: 'test',
        commands: this.actions.map(a => ({ ...a }))
      }]
    };
  }

  async upload(apiConfig, pageUrl) {
    const json = this.toUploadJson(apiConfig.url || pageUrl);
    const body = JSON.stringify(json);

    return new Promise((resolve, reject) => {
      const { hostOrigin, zdh_token, transcationId } = apiConfig;
      const urlObj = new URL('/api/transaction/transcationproperties/importDataByBS', hostOrigin);

      const formBoundary = `----${Date.now()}`;
      const fileContent = Buffer.from(body, 'utf-8');
      const formData = [
        `--${formBoundary}`,
        'Content-Disposition: form-data; name="file"; filename="result.txt"',
        'Content-Type: text/plain',
        '',
        body,
        `--${formBoundary}`,
        `Content-Disposition: form-data; name="mothed"`,
        '',
        'By.XPATH',
        `--${formBoundary}`,
        `Content-Disposition: form-data; name="transcationType"`,
        '',
        'web',
        `--${formBoundary}`,
        `Content-Disposition: form-data; name="transcationId"`,
        '',
        transcationId || '',
        `--${formBoundary}--`
      ].join('\r\n');

      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || 80,
        path: urlObj.pathname,
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${formBoundary}`,
          'Content-Length': Buffer.byteLength(formData),
          'access_token': zdh_token || ''
        }
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch { resolve({ code: res.statusCode, msg: data }); }
        });
      });
      req.on('error', reject);
      req.write(formData);
      req.end();
    });
  }

  async disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.pages = [];
    this.pageSessions.clear();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  function getOpt(name) {
    const idx = args.indexOf(`--${name}`);
    if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
    const short = args.find(a => a.startsWith(`--${name}=`));
    if (short) return short.split('=')[1];
    return null;
  }

  const agent = new CDPAgent();

  try {
    switch (cmd) {
      case 'connect': {
        const host = getOpt('host') || args[1];
        const port = parseInt(getOpt('port') || args[2] || '9222', 10);
        if (!host) throw new Error('用法: cdp-agent.mjs connect <host> [port]');
        const result = await agent.connect(host, port);
        console.log(JSON.stringify(result, null, 2));
        await agent.disconnect();
        break;
      }

      case 'snapshot': {
        const host = getOpt('host') || args[1];
        const port = parseInt(getOpt('port') || '9222', 10);
        await agent.connect(host, port);
        const pageId = getOpt('page') || agent.pages[0]?.id;
        if (!pageId) throw new Error('未发现页面');
        await agent.attachPage(pageId);
        const snapshot = await agent.snapshot(pageId);
        console.log(JSON.stringify({ ok: true, count: snapshot.length, elements: snapshot }, null, 2));
        await agent.disconnect();
        break;
      }

      case 'click': {
        const host = getOpt('host') || args[1];
        const port = parseInt(getOpt('port') || '9222', 10);
        const xpath = getOpt('xpath');
        if (!xpath) throw new Error('用法: cdp-agent.mjs click --xpath <xpath>');
        await agent.connect(host, port);
        const pageId = getOpt('page') || agent.pages[0]?.id;
        await agent.attachPage(pageId);
        const result = await agent.click(pageId, xpath);
        console.log(JSON.stringify(result, null, 2));
        await agent.disconnect();
        break;
      }

      case 'fill': {
        const host = getOpt('host') || args[1];
        const port = parseInt(getOpt('port') || '9222', 10);
        const xpath = getOpt('xpath');
        const value = getOpt('value');
        if (!xpath || value === null) throw new Error('用法: cdp-agent.mjs fill --xpath <xpath> --value <value>');
        await agent.connect(host, port);
        const pageId = getOpt('page') || agent.pages[0]?.id;
        await agent.attachPage(pageId);
        const result = await agent.fill(pageId, xpath, value);
        console.log(JSON.stringify(result, null, 2));
        await agent.disconnect();
        break;
      }

      case 'screenshot': {
        const host = getOpt('host') || args[1];
        const port = parseInt(getOpt('port') || '9222', 10);
        const output = getOpt('output');
        await agent.connect(host, port);
        const pageId = getOpt('page') || agent.pages[0]?.id;
        await agent.attachPage(pageId);
        const buf = await agent.screenshot(pageId);
        if (output) {
          const { writeFileSync } = await import('fs');
          writeFileSync(output, buf);
          console.log(JSON.stringify({ ok: true, path: output, size: buf.length }));
        } else {
          console.log(JSON.stringify({ ok: true, size: buf.length, base64: buf.toString('base64') }));
        }
        await agent.disconnect();
        break;
      }

      case 'source': {
        const host = getOpt('host') || args[1];
        const port = parseInt(getOpt('port') || '9222', 10);
        await agent.connect(host, port);
        const pageId = getOpt('page') || agent.pages[0]?.id;
        await agent.attachPage(pageId);
        const source = await agent.getSource(pageId);
        console.log(source);
        await agent.disconnect();
        break;
      }

      case 'elementinfo': {
        const host = getOpt('host') || args[1];
        const port = parseInt(getOpt('port') || '9222', 10);
        const xpath = getOpt('xpath');
        if (!xpath) throw new Error('用法: cdp-agent.mjs elementinfo --xpath <xpath>');
        await agent.connect(host, port);
        const pageId = getOpt('page') || agent.pages[0]?.id;
        await agent.attachPage(pageId);
        const info = await agent.getElementInfo(pageId, xpath);
        console.log(JSON.stringify(info, null, 2));
        await agent.disconnect();
        break;
      }

      case 'navigate': {
        const host = getOpt('host') || args[1];
        const port = parseInt(getOpt('port') || '9222', 10);
        const url = getOpt('url');
        if (!url) throw new Error('用法: cdp-agent.mjs navigate --url <url>');
        await agent.connect(host, port);
        const pageId = getOpt('page') || agent.pages[0]?.id;
        await agent.attachPage(pageId);
        const result = await agent.navigate(pageId, url);
        console.log(JSON.stringify({ ok: true, result }, null, 2));
        await agent.disconnect();
        break;
      }

      default:
        console.log(`用法: node cdp-agent.mjs <command> [options]

命令:
  connect <host> [port]             连接并列出页面
  snapshot --host <h> --page <id>   获取页面可交互元素快照
  click --host <h> --xpath <xpath>  点击元素
  fill --host <h> --xpath <x> --value <v>  填写输入框
  select --host <h> --xpath <x> --value <v>  下拉选择
  screenshot --host <h> --output <p> 截图
  source --host <h> --page <id>     获取页面HTML
  elementinfo --host <h> --xpath <x> 获取元素详情
  navigate --host <h> --url <url>   导航到页面

参数默认值: host=127.0.0.1, port=9222, page=第一个页面
`);
    }
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: err.message }));
    await agent.disconnect().catch(() => {});
    process.exit(1);
  }
}

if (process.argv[1] && (process.argv[1].endsWith('cdp-agent.mjs'))) {
  main();
}
