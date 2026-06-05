---
name: cdp-agent
description: |
  CDP-based browser automation for bank cabinet systems. Connect to old Chrome/CEF browsers via CDP WebSocket, interact with pages, and upload recorded actions to automation platform. For any task involving bank internal systems, cabinet terminals, or locked-down Chrome environments.
keywords:
  - "柜面系统"
  - "银行系统"
  - "浏览器自动化"
  - "CDP"
  - "chrome devtools protocol"
  - "cabinet"
  - "old chrome"
  - "embedded browser"
  - "web automation"
  - "自动化测试"
  - "UI测试"
  - "银行柜面"
  - "远程调试"
metadata:
  openclaw:
    emoji: "\U0001F4BB"
---

# cdp-agent — CDP 浏览器自动化（柜面系统专用）

通过 CDP 协议连接并操控老旧浏览器或嵌入式浏览器中的页面。
适合银行柜面系统、CEF 应用、版本低于 Playwright 要求的浏览器环境。

**IMPORTANT - Path Resolution:**
Before executing any commands, determine the skill directory based on where you loaded this SKILL.md file, and use that path in all commands below. Replace `{baseDir}` with the actual discovered path. The skill directory contains `scripts/cdp-agent.mjs` as the main executable.

Example resolved path:
- If SKILL.md is at `D:\dev\opencode-skill-use\.opencode\skills\cdp-agent\SKILL.md`
- Then `{baseDir}` = `D:\dev\opencode-skill-use\.opencode\skills\cdp-agent`

## 能力概述

| 操作 | 命令 | 描述 |
|------|------|------|
| 连接 | `connect` | 发现并连接 CDP WebSocket |
| 页面分析 | `snapshot` | 获取可交互元素快照（标签+XPath+坐标） |
| 元素查找 | `elementinfo` | 按 XPath 查询元素详情 |
| 点击 | `click` | 点击元素，自动记录操作 |
| 输入 | `fill` | 填写输入框，自动记录操作 |
| 下拉选择 | `select` | 下拉框选择，自动记录操作 |
| 截图 | `screenshot` | 截取页面截图 |
| 获取源码 | `source` | 获取页面 HTML |
| 导航 | `navigate` | 页面跳转 |
| 上传 | 编程调用 | 将操作记录上传到自动化平台 |

## 部署位置

```
{baseDir}/scripts/cdp-agent.mjs
```

所有命令使用统一前缀：

```bash
SKILL_DIR="{baseDir}"
```

## 连接流程

### 1. 发现并连接（每次任务第一步）

```bash
node "$SKILL_DIR/scripts/cdp-agent.mjs" connect --host <柜面IP> --port 9222
```

- `ok: true` + `pages[]` → 连接成功，获取页面列表
- `ok: false` + `error` → 检查网络可达性和 CDP 端口是否开放

### 2. 查看页面结构（重要：必须先于任何操作）

```bash
node "$SKILL_DIR/scripts/cdp-agent.mjs" snapshot --host <柜面IP> --port 9222 --page <pageId>
```

返回所有可交互元素的详细信息：
```json
{
  "ok": true,
  "count": 15,
  "elements": [
    {
      "tag": "input",
      "type": "text",
      "label": "用户名",
      "xpath": "//input[@placeholder=\"请输入用户名\"]",
      "visible": true,
      "value": "",
      "placeholder": "请输入用户名",
      "rect": { "width": 200, "height": 32, "top": 150, "left": 300 }
    }
  ]
}
```

**XPath 将自动使用 SmartSelector 算法生成最优路径**，优先级：
1. ID / data-testid
2. placeholder
3. name / title / class / alt
4. 文本内容
5. 层级路径（兜底）

### 3. 执行操作

**点击元素**（先通过 snapshot 或 elementinfo 确认 XPath 有效）：

```bash
node "$SKILL_DIR/scripts/cdp-agent.mjs" click --host <柜面IP> --xpath "//button[text()='登录']"
```

**填写输入框**：

```bash
node "$SKILL_DIR/scripts/cdp-agent.mjs" fill --host <柜面IP> --xpath "//input[@placeholder='请输入用户名']" --value "admin"
```

**下拉选择**：

```bash
node "$SKILL_DIR/scripts/cdp-agent.mjs" select --host <柜面IP> --xpath "//select[@name='type']" --value "01"
```

**截图**：

```bash
node "$SKILL_DIR/scripts/cdp-agent.mjs" screenshot --host <柜面IP> --output /tmp/screenshot.png
```

**获取页面源码**：

```bash
node "$SKILL_DIR/scripts/cdp-agent.mjs" source --host <柜面IP>
```

**元素详细信息**（获取业务对象名称、属性等）：

```bash
node "$SKILL_DIR/scripts/cdp-agent.mjs" elementinfo --host <柜面IP> --xpath "//button[text()='登录']"
```

### 4. 上传到自动化平台（程序内调用）

在编程脚本中，操作完成后调用 upload：

```javascript
import { CDPAgent } from '/path/to/cdp-agent.mjs';

const agent = new CDPAgent();
await agent.connect('柜面IP', 9222);
const pageId = agent.pages[0].id;
await agent.attachPage(pageId);

// 执行操作...
await agent.click(pageId, '//button[text()="登录"]');
await agent.fill(pageId, '//input[@placeholder="用户名"]', 'admin');

// 上传到自动化流水线
const result = await agent.upload({
  hostOrigin: 'http://自动化平台地址:端口',
  zdh_token: 'your-token',
  transcationId: 'transcation-id'
});
console.log('上传结果:', result);

await agent.disconnect();
```

## 操作记录兼容性

每次 click / fill / select 操作**自动记录**为与录制插件完全兼容的格式：

```json
{
  "command": "click",
  "target": "//button[text()='登录']",
  "targetType": "xpath",
  "tagName": "button",
  "propertiesName": "登录",
  "value": "",
  "timestamp": 1712345678901
}
```

可通过 `agent.getRecordedActions()` 获取全部记录列表。
可通过 `agent.toUploadJson(url)` 获取标准上传 JSON。

## 上传接口

上传时使用与现有插件相同的 API：

```
POST {hostOrigin}/api/transaction/transcationproperties/importDataByBS
Content-Type: multipart/form-data
access_token: {zdh_token}

file: result.txt (JSON 脚本)
mothed: "By.XPATH"
transcationType: "web"
transcationId: {transcationId}
```

## 参数说明

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--host` | `127.0.0.1` | 柜面机器 IP |
| `--port` | `9222` | CDP 调试端口 |
| `--page` | 第一个页面 | 目标页面 ID（`connect` 时可查看） |
| `--xpath` | - | 元素的 XPath 路径 |
| `--value` | - | 输入/选择的值 |
| `--output` | - | 截图输出路径 |

## 常见问题

### 连接失败
- 确认柜面系统已用 `--remote-debugging-port=9222` 启动
- 确认网络可达（ping 柜面 IP）
- 确认防火墙未拦截 9222 端口

### 元素操作失败
- CDP connect → snapshot → 查看 `xpath` 字段确认元素存在
- 某些旧版本 Chrome 不支持 `Page.captureScreenshot`，会报错
- 如 SmartSelector 生成的 XPath 不唯一，尝试用 `elementinfo` 查看元素属性后手动指定 XPath

### 上传失败
- 确认 `hostOrigin`、`zdh_token`、`transcationId` 正确
- 操作记录可通过 `agent.getRecordedActions()` 导出为 JSON 手动检查
