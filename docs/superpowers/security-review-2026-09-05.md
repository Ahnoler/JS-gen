# 安全审查报告：8 月集中开发整体排查（2026-09-05）

> 四路并行只读审查（Node API 面 / executor·CDP·WS 通道 / Python·migrations / 仓库卫生）+ 主线程抽验。
> 基线 = `code-review-2026-08-31.md`（P0×7+P1×5+Python×3 已修，本轮复核**均未回退**）。
> 本轮只报告不修码；修复方案经用户拍板后另立任务执行。

## 总览

| 级别 | 数量 | 一句话 |
|---|---|---|
| P0 | 5 | 凭据/屏幕画面可被未鉴权获取；两枚真实 JWT 入库 |
| P1 | 6 | 鉴权可失效、sessionId 路径遍历、executor 上行事件全信 |
| P2 | 10+ | 分页上限、时序比较、凭据加密等加固项 |

**最紧迫三件事**（详见 P0 区）：① `/ws` + `/api/browser/*` 无鉴权且监听 0.0.0.0；② `system-mgmt/tree` 未鉴权回显被测系统明文密码；③ 两枚真实 JWT 已在仓库（伙伴平台 token + SSO 验签密钥）。另：`.env.example` 工作区未提交改动把占位符改回了真实值（SSO_JWT_SECRET 等）——**他线 WIP，提交前必须还原**。MinIO 密码/EXECUTOR_TOKEN 轮换自 8-31 起至今仍未做。

## P0（直接可利用 / 凭据外泄）

| # | 项 | 位置 | 要点 |
|---|---|---|---|
| P0-1 | 仪表盘 `/ws` 完全无鉴权 + 监听 0.0.0.0 | server.mjs:51,86-91; executor-ws.js:246-256 | 内网任意主机可订阅全部 RSCF 屏幕帧（SUT 含 PII）、读 remote:clipboard、发 remote:input 操控 SUT、session:step 驱动 agent；二进制帧全客户端洪泛不过滤 |
| P0-2 | `/api/browser/*` 全组路由无鉴权 | server.mjs:37; watcher-actions.js:24-75 | `watcher/action` 可对活跃会话透传任意 cdp_action；manual-record/auto-persist/DELETE browser 同裸奔 |
| P0-3 | 被测系统账号明文密码经只读接口整库回显 | system-mgmt.js:100（默认含 accounts）; hierarchy-tree-query.js:97 | SSO_AUTH_REQUIRED 默认 false，`GET /api/v2/system-mgmt/tree` 即拉走全部登录账号+密码 |
| P0-4 | 两枚真实 JWT + SSO 验签密钥硬编码入库 | partner-platform.js:20-21; characterize-sso-auth.mjs:21-25 | 伙伴平台 debug token（userId 151007…）自动回落出网；特征化脚本内置真实 admin JWT + 真实验签密钥 `paas-application` |
| P0-5 | `.env.example` 占位符被工作区改动回真实值（未提交） | config/.env.example:172-186 附近 | SSO_JWT_SECRET=真实验签密钥等三处；**他线 WIP 勿代改，提交前必须还原** |
| P0-6 | MinIO 密码 / EXECUTOR_TOKEN 轮换未做（8-31 挂账至今） | config/.env（本地）；start-executor-proxy.cmd:10 | 现网 token 弱值 `server1` 已随 cmd 脚本入库；旧泄漏值在 git 历史可取回，轮换是唯一闭环 |

## P1（需条件利用）

1. **agent-stderr sessionId 路径遍历**（agent-stderr-log-service.js:64-66,93-97）：`?sessionId=../../x` 可读/删任意 `.log`；补 `path.relative` 包含校验 + 字符白名单。
2. **executor 上行事件完全可信**（executor-ws.js:183-256）：不校验 sessionId 属主——可伪造 action_log_sync 注入步骤、伪造 session.ready 污染租约、经 agent_stderr 任意目录写 `.log`；未注册连接也可发 RSCF 假截图。修法=注册前丢弃非 executor.* 消息 + sessionId 归属校验 + 路径 basename 化。
3. **SSO 验签可降级失效 + token 永不过期**（sso-auth.js:36-39; jwt-decode.js:46-60）：`SSO_AUTH_REQUIRED=true` 下密钥拉取失败应 fail-closed，当前却"降级纯解"采信任意自签 JWT；iat/过期不校验。
4. **非 /api/v2 路由整体在 SSO 之外**（v2/__init__.js:39; server.mjs:36-43）：`/v1/chat/completions` 可被内网当免费 LLM 网关耗配额（且 /models 两处仍无超时、回显 LLM_BASE_URL）。
5. **event hub 无限制造**（executor-event-hub.js:13-18）：恶意连接发 N 个新 sessionId 泄漏 N 个 EventEmitter。
6. **WS maxPayload 未设**（executor-ws.js:306; ws-server.js:105）：默认 100MB 入站缓冲，单连接可放大约 100MB 帧给全部 dashboard。

## P2（加固）

分页无上限（business-data/api-override/remote-session/trajectory 四 dao）；SSO login/logout 回跳未校验（开放重定向辅助）；HMAC 比较非常数时间（jwt-decode.js:55、executor-ws.js:31）；账号密码明文落库（hierarchy-service.js:234，建议 AES-GCM）；SSO 开启时写侧 IDOR（batch cancel / remote-session close/delete 不校验属主）；LLM API key 进子进程 argv（session-slot.js:88-94，Windows 本机进程列表可见）；Python watcher 日志 params 未脱敏（session_runner.py:156,173，实证 logs/log.txt:9 已有 `login {'username':'701994','password':'1'}`）；session_id 拼 tmp 路径未校验（session_runner.py:326,385）；go_to_url 无 scheme 白名单（_replay.py:250-260，可 file://）；提示词 include 可读 scripts 外 .md（agent_utils.py:107-120）；cdp_action 参数不走路由白名单（白名单只覆盖 replay 事件）；slowloris（requestTimeout/headersTimeout=0 配 0.0.0.0）；`.gitignore` 的 `!docs/report/**` 与后文冲突；test 凭据散布 logs/（建议 ignore logs/）。

## 审查确认无问题的方面

SQL 全参数化；无命令注入（spawn 数组参数、无 shell:true）；JS 片段一律 evaluate 传参（基线 scroll int 强转未回退）；无 eval/pickle/yaml.load；migrations 无危险操作；SSRF 面（出网目标均 env/常量）；错误响应不漏堆栈；上传有大小限制；JWT 算法固定无混淆面；`/ws/executor` token 空值拒绝；CDP 只绑 127.0.0.1 且 Runtime.evaluate 仅固定表达式；RSCF 生产端背压正确；基线 P0×7+P1×5+Python×3 全部在位未回退。

## 修复路线建议（待拍板）

- **第一批（当天可完成，纯删/掩码）**：P0-4 移除两枚 JWT 改 env + 轮换；P0-3 tree/ getNode 不回传 password；P0-5 提交前还原 .env.example。
- **第二批（半天）**：P0-1 `/ws` 升级加 token + RSCF 按订阅过滤 + HOST 默认改 127.0.0.1（服务器部署按需显式开）；P0-2 `/api/browser/*` 纳入鉴权。
- **第三批（1 天）**：P1-1/2/3/5（路径校验 + executor 上行归属校验 + hub 限额 + maxPayload）；P1-4 SSO fail-closed。
- **仓库外人工**：P0-6 MinIO/EXECUTOR_TOKEN 轮换（需服务器操作）。
