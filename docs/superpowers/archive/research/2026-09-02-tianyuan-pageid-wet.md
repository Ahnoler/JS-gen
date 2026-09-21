# 天元 pageId 读码湿测（2026-09-02）

## 方法
Playwright 登录信贷测试环境，点菜单 → 开「天元相关配置」，记录 hash / 页面路径 / 组件编号。
脚本：`tmp/probe_tianyuan_wet_research.py` → `tmp/tianyuan_wet_research.json`。

## 结论

| 类型 | 代表菜单 | 现象 |
|------|----------|------|
| 有码且路径=hash | 业务扩展类 | 400ms 内可读到 `ZJJK00070199`，pathOk=true |
| 空壳无码 | 待办任务、首页管理、外系统接入、数字信贷若干、卡片库等 | 浮窗存在，弹窗仅「天元相关配置确 定」，**无页面路径/组件编号**（12s 仍空） |

因此 fill 大量 skip **多数不是扫漏，是页面未配置天元组件编号**。

## 自动化误判根因（曾有）
1. 页脚「确 定」粘进编号 → 校验失败（已修 `确\s*定`）
2. 菜单点击后立刻读码，SPA 未落稳 / 粘上页弹窗 → timeout 或错写
3. `ok-from-diag` 无路径兜底 → 曾把「其他资产」编号写到「对公进件分配」（已禁）

## 优化（`page_id.py`）
- 开弹窗前 `sleep(1000)` 等路由
- 每轮重读 `location.hash`
- 空壳稳定 ~1.5s → `reason=empty-config` 早退
- 「加载中」继续等到 ~18s
- 仍要求页面路径匹配当前路由才采纳编号
- **结构化解析**：优先 `.el-dialog__body .info p > span` 标签/值对；关着的 `.info`（`display:none`）**不随路由刷新**，必须每页点开「？」
- **fill 加速**：`menu-scan-pageid.js` 按 `parentId` 排序，同 L1 连续时跳过重复一级菜单 click

## 关着 DOM 探针
`tmp/probe_tianyuan_closed_dom.py`：路由切换后未点开「？」时，隐藏 dialog 仍是上页内容 → 禁止只读 closed DOM。
