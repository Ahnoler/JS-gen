# Design: Draft-Traj Coach Runtime（对标 recording-coach）

> 日期：2026-09-24  
> 状态：已批准会话设计；待落地实现  
> Skill 真源：`tools/draft-traj-coach/skill/SKILL.md`  
> 对标：`tools/recording-coach/` + `docs/superpowers/specs/2026-09-18-recording-coach-opencode-design.md`  
> 相关：`docs/superpowers/specs/2026-09-20-draft-traj-coach-sop-design.md`（将「src 预约」升级为本规格的实现目标）

## 1. 目标

在 `tools/draft-traj-coach/` 落地与 recording-coach **同形**的旁路运行时：

1. OpenCode plugin（工具注册）+ 可选 OpenCode 多轮会话  
2. `workflow.json` 为权威状态机（phase / inputs / 证据路径）  
3. Skill 契约中的全部预留工具（HTTP + 本地文件）  
4. CLI：`node src/index.mjs`（默认尝试 OpenCode；`--cli-only`；`--tool`；`--resume`）

**成功判据**

- 操作员可按 skill 顺序跑通：CollectInputs → … → Proposed → AwaitingPick；确认 atomKeys 后 → Validated → Committed → Done  
- **未确认 atomKeys 时 `commit_drafts` 硬失败**（CLI / plugin 一致）  
- 终点仅为 `recordStatus=draft` 交易；禁止 prepare / record / 写 flows / promote  
- `chapters/` 只读；改链仅 `through-chains.md`（先备份到证据目录）  
- 闸门通过 ≠ 质量达标；`present_pick_list` 必须按 gold/thin 分拣  

**非目标（本 PR）**

- 产品路径 `engine: opencode` / 改 `src/services/req-draft-traj/*` 业务硬闸逻辑  
- 自动录制、batch、recording-coach 合并  
- 改 atomize prompt / cohesion gates（质量提升另线）  
- 把 quality 分拣塞进服务端门禁  

## 2. 仓库与分支

| 项 | 值 |
|----|-----|
| Repo | `https://github.com/lianshanhzx/ui-auto-recording-agent-vue` |
| Base | `V2.0_dev` |
| 改动根 | `js-project/tools/draft-traj-coach/` + 本规格文档 |
| 控制面 | 默认 `http://127.0.0.1:4097`（`JSGEN_BASE_URL`） |
| OpenCode 嵌入端口 | **4096**（与 4097 分离，同 recording-coach） |

## 3. 目录形态

```text
tools/draft-traj-coach/
  README.md                 # 更新：skill + 已实现 src
  package.json
  package-lock.json         # 若安装依赖
  skill/                    # 已有；真源不变，仅必要时微调表述「src 已实现」
  src/
    index.mjs               # CLI / OpenCode 入口
    workflow.mjs            # phases、迁移表、证据目录
    http.mjs                # GET/POST/multipart 客户端（可复制精简 recording-coach）
    tools.mjs               # 全部工具 handlers + phase 闸
    opencode-plugin.mjs     # tool 描述符 / @opencode-ai/plugin
    opencode-session.mjs    # 可选：createOpencode 会话（对标 recording-coach）
    close-contract.mjs      # close.txt / through-report 契约
    pick-list.mjs           # near_gold / thin 分拣（读 skill references 规则的可测子集）
    # 其他小模块按需拆分（dispatch-brief 校验等）
```

证据目录：`js-project/tmp/draft-traj-coach-<ISO>/`（gitignore 已覆盖 `tmp/` 则沿用）。

## 4. 双会话模型

| 层 | 职责 | 权威 |
|----|------|------|
| OpenCode Session | 多轮对话、tool 调用轨迹 | OpenCode 运行时 |
| Coach Workflow | phase、moduleKey、confirmedAtomKeys、证据路径 | **`workflow.json`** |

约定（同 recording-coach）：

1. 一次湿测/作业 = 一个证据目录；OpenCode session id 写入 workflow，不单独当权威。  
2. **仅 tool 成功回调推进 phase**；模型不得直接写 `phase=Done`。  
3. `RefineChains` / 重 propose **不换证据目录**（除非操作员显式新开）。  

## 5. 状态机

```text
CollectInputs → SourceReady → Sliced → Proposed → AwaitingPick
                     ↑            ↓         ↓
                     └──────── RefineChains ←┘
AwaitingPick → Validated → Committed → Done
```

| Phase | 进入条件 | 主要工具 | 退出 |
|-------|----------|----------|------|
| CollectInputs | 新建证据目录 | `save_dispatch_brief`（若采用）、写入 inputs | → SourceReady 或已 sliced → Sliced |
| SourceReady | 已登记模块 / 可读 source | `register_module` / `upload_source` / `parse_module` | → Sliced |
| Sliced | `canProposeAtoms=true` 或等价 | `read_workspace` / `propose_atoms` | → Proposed |
| Proposed | propose 返回 | `present_pick_list`；可选 `rewrite_through_chains` | → AwaitingPick 或 RefineChains |
| RefineChains | 质量差 / thin 过高 | **只**改 `through-chains.md` + 清 propose cache 标记 | → Proposed（重 propose） |
| AwaitingPick | 已写出 pick-list | **等待**确认 `atomKeys`（工具如 `confirm_atom_keys` 或 `present_pick_list` 的 confirm 参数） | → Validated 路径 |
| Validated | `validate_atoms` 通过或可解释 problems | `commit_drafts` | → Committed |
| Committed | commit 成功 | `write_through_report` | → Done |
| Done | close.txt 已写 | — | 终态 |

未勾选结束：允许停在 Proposed/AwaitingPick，结论前缀 `PROPOSED_`（**不算 Done**）。

实现须在 `workflow.mjs` 维护 `ALLOWED` 迁移表；非法迁移抛错。

## 6. 工具契约

HTTP 对照真源：`skill/references/api-map.md`。

| 工具 | 行为要点 |
|------|----------|
| `register_module` | `POST /api/v2/kb/req-modules` |
| `upload_source` | multipart `file` → `…/source` |
| `parse_module` | `POST …/parse`；客户端超时 ≥300s |
| `read_workspace` | `GET …/req-modules/{moduleKey}` + 读盘 through-chains/chapters 摘要 + `wet-test.md` / 可选 `sut-settled.md` |
| `propose_atoms` | `POST …/draft-traj/propose`；可传 chainIds/maxAtoms |
| `rewrite_through_chains` | 备份到证据目录 → 写模块 `through-chains.md` → 删除/标记 `.draft-traj-propose.json` 失效 |
| `present_pick_list` | 写建议勾选 + rejected 表；**分拣** near_gold / thin（规则对齐 `taskdraft-quality.md` 的可执行子集） |
| `validate_atoms` | `POST …/draft-traj/validate`；仅已确认 atomKeys |
| `commit_drafts` | **硬闸**：`workflow.confirmedAtomKeys` 非空且为本轮确认集，否则拒绝；`POST …/draft-traj/commit` |
| `write_through_report` | `through-report.md` + `close.txt`；最后一条用户可见消息与 close.txt 全文一致 |

辅助（对标 recording-coach，便于 CLI）：

- `save_dispatch_brief`：校验并写入证据目录（模板 `skill/templates/dispatch-brief.md`）  
- `mark_inputs_ready` / `confirm_atom_keys`：推进 CollectInputs / AwaitingPick（命名以实现为准，须在 README + skill 同步）  
- `get_status`：读 workflow 摘要  

### 6.1 硬闸与禁区

1. 无确认 `atomKeys` → 禁止 `commit_drafts`（含绕过 HTTP 的「操作员手滑」：工具层拒绝）  
2. 禁止任何 prepare / record / `record/start`  
3. 禁止写 `data/kb/flows`、禁止 git commit、禁止 promote  
4. `chapters/` 只读  
5. 默认不 `force` commit；重复 atom 按服务端 skip/duplicate 行为透传  
6. STALE propose cache → 要求重 propose，禁止强行 commit  

## 7. CLI / OpenCode 入口

对标 `recording-coach/src/index.mjs`：

```bash
cd tools/draft-traj-coach
npm install
node src/index.mjs                  # OpenCode（失败则 REPL）
node src/index.mjs --cli-only
node src/index.mjs --tool propose_atoms --args '{"moduleKey":"product-mgmt"}'
node src/index.mjs --resume tmp/draft-traj-coach-…
```

环境变量：`JSGEN_BASE_URL`（默认 `http://127.0.0.1:4097`）。

## 8. close.txt 契约

前缀仅允许：`PROPOSED_` / `COMMITTED_` / `BLOCKED_` / `REJECTED_` / `ERROR`（与 skill 一致）。  
字段：结论 / 轨迹或证据路径 / 证明 1–3。模板：`skill/templates/close.txt`。

## 9. 测试与验收

**冷测（第一版必做，无 4097）**

- 非法 phase 迁移失败  
- 未确认 atomKeys 时 `commit_drafts` 失败  
- close 契约格式（结论前缀）  
-（可选）pick-list 分拣：给定 fixture drafts → near_gold/thin 标签稳定  

建议路径：`scripts/characterization/cold/characterize-draft-traj-coach-*.mjs`，并挂到现有 `verify-all` 入口（若改动成本低）。

**湿测（有 4097，手动清单）**

- product-mgmt：propose → present_pick_list → 停在 AwaitingPick  
- 人工确认后 validate → commit → Done + close.txt  

**Skill evals**：`skill/evals/evals.json` 保持 prompt 级；**不**作为合并门禁。

## 10. 实现顺序（给实现 PR）

1. `package.json` + `http.mjs` + `workflow.mjs`（空证据目录 + 迁移表）  
2. `tools.mjs`：硬闸与各 HTTP/文件工具；单测/冷测钉住 commit 闸  
3. `opencode-plugin.mjs` + `index.mjs`（`--cli-only` / `--tool` / `--resume`）  
4. OpenCode session 接线（可与 recording-coach 同策略：SDK 可用则会话，否则 REPL）  
5. 更新 `tools/draft-traj-coach/README.md`；本规格已合并则在 SOP 规格顶部加「Runtime：见 2026-09-24」交叉链接  
6. 冷测绿；PR 描述附湿测清单（不要求 CI 起 4097）

## 11. 风险

| 风险 | 缓解 |
|------|------|
| 复制 recording-coach 过重 | 只抽 http/workflow/cli 骨架；不拷贝录制/poll/CDP |
| pick-list 质量规则过软/过硬 | 第一版用 references 可测子集 + fixture；规则演进不阻塞 runtime |
| GitHub 远端与内网 origin 双远程 | PR 开在 `lianshanhzx/ui-auto-recording-agent-vue` 的 `V2.0_dev` |

## 12. 批准记录

- 2026-09-24：会话批准「完整对标 recording-coach：OpenCode plugin + workflow + 全部 skill 工具 + CLI/--cli-only」  
- 实现前须用户再确认**本规格文件**无歧义后，再开 writing-plans / 实现 PR  
