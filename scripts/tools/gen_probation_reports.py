#!/usr/bin/env python3
"""Regenerate docs/report/*.md in standard probation daily format."""
from __future__ import annotations

import re
import subprocess
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REPORT_DIR = ROOT / "docs" / "report"
PARTICIPANT = "limiaoyi"

# id -> {title, open, close?, note}
LEGACY: dict[str, dict] = {
    "semantic-fill": {
        "title": "填表按语义索引优化（关键数据绑定后）",
        "open": "2026-07-27",
        "close": None,
        "note": "关键数据已绑定交易；按 label 语义填表仍待产品化",
    },
    "python-sync": {
        "title": "Python 控制面对齐（schema / API / WS）",
        "open": "2026-07-14",
        "close": None,
        "note": "CHANGELOG 多条「Python 同步提示」待 ui-auto-recording-agent-python 跟进",
    },
    "vue-spa": {
        "title": "产品 Vue SPA 外仓联调（BiB/录制/资产库 UI）",
        "open": "2026-07-20",
        "close": None,
        "note": "本仓以 API 为主；前端拖拽、批量导入 radio 等在外仓",
    },
    "legacy-replay": {
        "title": "/replay/* Playwright 全量回放（工程资产）",
        "open": "2026-08-04",
        "close": None,
        "note": "产品主路径为 steps/replay；全量组装回放非产品承诺",
    },
    "user-mgmt": {
        "title": "用户管理体系接入（created_by 真实落人）",
        "open": "2026-08-06",
        "close": None,
        "note": "schema 已预留 created_by/updated_by，列表暂显示空串",
    },
    "component-lib-ref": {
        "title": "操作组件库接入录制/回放引用",
        "open": "2026-08-06",
        "close": None,
        "note": "Phase 1 仅沉淀 mine+CRUD，刻意不接 login/录制引用",
    },
    "agent-full-scan": {
        "title": "主 Agent 全页 DOM 扫描（Future TODO）",
        "open": "2026-08-07",
        "close": None,
        "note": "当日增强助手/section；主 Agent 全页扫描未做",
    },
    "option-first-cleanup": {
        "title": "清理 phase 内 option_text=first 脏步骤",
        "open": "2026-08-08",
        "close": None,
        "note": "xpath 回放审计要求 acceptance 前清库/重录",
    },
}

# Closed on specific dates (updates LEGACY close field when rendering)
LEGACY_CLOSES: dict[str, str] = {
    "confirmed-replay": ("2026-08-04", "steps/replay confirmed 语义与 Type B 框架"),
    "remote-dirty": ("2026-08-04", "remote_session 脏指针与多浏览器占用"),
    "case-data-inject": ("2026-08-05", "案例数据注入与引入类 KV 解析"),
    "ws-halfopen": ("2026-08-06", "WS 半开连接检测与 action_log 补拉"),
    "typeb-container": ("2026-08-06", "Type B 按 container 选根与 unsafe diff 护栏"),
    "close-drawer": ("2026-08-07", "close_dialog 无法关 el-drawer（轨迹 36）"),
    "batch-draft-api": ("2026-08-07", "批量导入 draft 模式本仓 API/调度"),
    "steps-move-api": ("2026-08-07", "轨迹步骤 POST .../steps/move 后端"),
    "xpath-primary": ("2026-08-08", "xpath-primary 写入与 section 作用域"),
    "params-replay": ("2026-08-08", "回放 params-first xpath + 写 xpath 盖章"),
    "phase-runtime": ("2026-08-08", "阶段运行时加固（empty-act / quality）"),
    "pkg-refactor": ("2026-08-08", "controller/services 包结构大规模重构"),
}

DAY_CLOSES: dict[str, list[tuple[str, str]]] = defaultdict(list)
for _id, (d, title) in LEGACY_CLOSES.items():
    DAY_CLOSES[d].append((title, f"当日提交已合入"))

HANDCRAFTED: dict[str, list[str]] = {
    "2026-07-01": ["自动填表浏览器插件初版提交（外仓协作）。"],
    "2026-07-02": [
        "表单项识别与行业代码 tree-select 填写。",
        "FormSnapshot 按次独立快照；needs_intervention 人工干预闭环。",
        "sync_tasks_from_errors 与 scroll_to_first_error 集成。",
    ],
    "2026-07-03": [
        "引入流程人工干预、手机号校验、操作自动滚动。",
        "CDP 连接进程内浏览器，支持实时脚本注入。",
        "优化 scan_form_fields 返回摘要。",
    ],
    "2026-07-04": ["统一管理 Browser/Planner/Form/Heal 四类 Agent 提示词。"],
    "2026-07-06": [
        "干预闭环：intervention_needed → 用户方案 → intervention_resolved。",
        "移除 Workflow、LLM Playwright 生成器；增加快速操作 CDP 注入。",
        "表格行内按钮/radio；移除 OpenCode SDK；.env 与 config 落地。",
    ],
    "2026-07-07": ["browser-use 依赖内置化（多轮迭代）。"],
    "2026-07-08": ["V1.3 稳定版本标记与打包。"],
    "2026-07-09": ["组装器与表单结构校验注入优化；快速操作 CDP 注入验证。"],
    "2026-07-13": [
        "Replay 与 phase_number 原子步骤；实时动作流与分阶段展示。",
        "修复默认值字段误触发重填；人工干预 SSE 改用 ExecuteSessionStep。",
    ],
    "2026-07-14": [
        "引入 knex/mysql2 与 v2 路由；会话轨迹与用例数据双写 MySQL。",
        "层级管理功能与轨迹表结构增强（trajectory_log、phase_count）。",
    ],
    "2026-07-15": [
        "旧 JSON 路由 410；manual_recorder 与 MySQL 持久化增强。",
        "远程 BiB CDP 桥接；人工录制 ACTION_LOG 集成。",
        "修复 manual/cdp 步骤被 persistedActionIds 误过滤。",
    ],
    "2026-07-17": [
        "执行机 agent 运行时与控制面 WS 注册。",
        "层级合并入 system 树；录制 prepare/stop 与 phase 定向 API。",
        "相关 schema 迁移与 executor 本地密钥 gitignore。",
    ],
    "2026-07-20": [
        "录制 studio prepare 加固与 autofill 式单步回放。",
        "system-mgmt 树 API 对齐前端（1-based type、嵌套 children、/api/docs）。",
    ],
    "2026-07-21": [
        "prepare 复用 idle Chrome；BiB 页签同步与空闲槽位回收。",
        "自愈场景复现走 _replay；detach 完全关闭 Chromium。",
        "按 phaseIds 清空步骤；BiB 导航与推流清晰度。",
    ],
    "2026-07-22": [
        "人工确认字段；steps/replay 失败修复与 ok* 统一。",
        "resolve-element CDP API；执行机默认 16 槽；Excel 系统树导入导出。",
        "人工录制与快速操作入库路径唯一。",
    ],
    "2026-07-23": ["轨迹 analyze 阶段强制要求预期结果（expected results）。"],
    "2026-07-24": [
        "xpath_smart 增强 AI 点击录制；录制生命周期服务拆分。",
        "CTRL 单源校验；browser-session / trajectory 大规模 refactor。",
        "取消 record/stop 延迟；v2 trajectories 列表与 status 筛选。",
    ],
    "2026-07-27": [
        "清理 trace/trajectory 文件落盘；对齐 Playwright 版本。",
        "修复 DB 表导入顺序；空闲回收后前端状态同步。",
        "关键数据绑定交易；优化浏览器资源利用。",
    ],
    "2026-07-28": [
        "多交易 BiB 推流隔离与 stream/detach。",
        "修复推流后「能看不能点」：resolveExecutorPick / resolveBibTarget。",
        "remote_session idle/bindings 迁移；Linux root Chromium 沙箱参数。",
    ],
    "2026-07-29": [
        "AI 录制填表修复（匹配错误、阶段结束、重复填表）。",
        "案例数据 commandValue 联动覆盖修复；图标按钮识别。",
    ],
    "2026-07-30": ["移除遗留工程 HTML；自愈框架初步搭建；案例数据 trajectory 校验。"],
    "2026-07-31": [
        "AI 长程上下文（phase preamble、memory whitelist）。",
        "legacy-engine 导出 API；步骤合并与 icon-button 发现修复。",
    ],
    "2026-08-01": ["步骤截图绑定 trajectory_step_id，按 kind UPSERT。"],
    "2026-08-02": ["xpath_smart 录制优先；单步 heal 收紧；截图 FK 迁移。"],
    "2026-08-03": ["特殊元素库与 sys_dict；AI 复用检索路径。"],
    "2026-08-04": [
        "steps/replay confirmed 语义与 Type B 表单结构自愈框架。",
        "阶段意图契约、case-data V2.2；remote_session 脏指针修复。",
        "replay/stop、BiB 调优、catalog tree-select 分类与图标按钮。",
    ],
    "2026-08-05": [
        "AI 记忆系统 P0+P1 与 P2 审计/跨交易复用。",
        "案例数据注入链路修复；业务数据与 system_ref 分离。",
        "xpath_smart 增强；向导/打开页面阶段边界；WS 断线缓冲。",
    ],
    "2026-08-06": [
        "操作组件库 Phase 1；库列表筛选与 created_by 占位。",
        "WS 半开连接完整修复与 form_batch 心跳。",
        "Type B container 选根与 unsafe diff 护栏；阶段评审器与显式 form_assistant。",
    ],
    "2026-08-07": [
        "阶段契约 Done 闸门；control-first/xpath-first 扫描与 section 闭环。",
        "批量导入 draft 模式；步骤 drag reorder API。",
        "close_dialog drawer 修复；CHROME_HEADLESS；select 懒加载。",
    ],
    "2026-08-08": [
        "xpath-primary 字段写入与 section 作用域闸门。",
        "表单助手 mission/needs_agent；Agent prompt 按阶段分包。",
        "回放 params-first xpath 审计；阶段运行时加固；写 xpath 盖章元素。",
        "controller/services/routes 大规模包结构重构。",
    ],
}


def _run_git_log() -> list[tuple[str, str, str]]:
    out = subprocess.check_output(
        [
            "git",
            "log",
            "--since=2026-07-01",
            "--until=2026-08-08 23:59:59",
            "--pretty=format:%ad|%an|%s",
            "--date=format:%Y-%m-%d|%H:%M",
            "--reverse",
        ],
        cwd=ROOT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    rows: list[tuple[str, str, str]] = []
    for line in out.splitlines():
        if not line.strip():
            continue
        day, tm, author, subject = line.split("|", 3)
        rows.append((day, tm, author, subject))
    return rows


def _legacy_rows(day: str) -> list[tuple[str, str, str]]:
    d = date.fromisoformat(day)
    rows: list[tuple[str, str, str]] = []
    for item in LEGACY.values():
        open_d = date.fromisoformat(item["open"])
        close_s = item.get("close")
        close_d = date.fromisoformat(close_s) if close_s else None
        if open_d > d:
            continue
        if close_d and close_d < d:
            continue
        status = "仍遗留" if not close_d or close_d > d else "已闭环"
        if close_d and close_d == d:
            status = "已闭环"
        rows.append((item["title"], status, item["note"]))
    for title, note in DAY_CLOSES.get(day, []):
        rows.append((title, "已闭环", note))
    if not rows:
        prev = (datetime.strptime(day, "%Y-%m-%d").date()).isoformat()
        rows.append(("（无前日结构化遗留对照）", "—", f"首日或 git 无法推断；见 {prev} 前序提交。"))
    return rows


def _major_items(day: str, subjects: list[str]) -> list[str]:
    if day in HANDCRAFTED:
        return HANDCRAFTED[day]
    # fallback: unique subjects, skip noise
    skip = re.compile(r"^(修改提交范围|测试文件|看 CHANGELOG|superpowers|smoke 不提交|代码知识图谱)", re.I)
    items = []
    seen = set()
    for s in subjects:
        if skip.search(s):
            continue
        key = s[:80]
        if key in seen:
            continue
        seen.add(key)
        items.append(s if len(s) < 120 else s[:117] + "…")
    return items[:10] if items else ["（当日无 limiaoyi 提交或仅协作提交）"]


def _render(day: str, commits: list[tuple[str, str, str]]) -> str:
    subjects = [c[3] for c in commits]
    majors = _major_items(day, subjects)
    legacy = _legacy_rows(day)
    n = len(commits)
    lines = [
        f"# {day} 工作日报",
        "",
        f"> 统计窗口：北京时间 {day} 00:00–24:00（Asia/Shanghai）",
        f"> 仓库提交：{n} 条（本表列示当日全部作者提交）",
        "",
        "## 主要事项",
        "",
    ]
    for m in majors:
        lines.append(f"- {m}")
    lines += [
        "",
        "## 遗留事项进度",
        "",
        f"> 对照：前日 `docs/report/` 归档及当日 CHANGELOG；参与人工作以 {PARTICIPANT} 为主。",
        "",
        "| 事项 | 状态 | 说明 |",
        "| --- | --- | --- |",
    ]
    for title, status, note in legacy:
        lines.append(f"| {title} | **{status}** | {note} |")
    lines += [
        "",
        "## 参与人",
        "",
        f"- {PARTICIPANT}",
        "",
        "## 提交明细",
        "",
        "| 时间 (CST) | 作者 | 说明 |",
        "| --- | --- | --- |",
    ]
    if commits:
        for _, tm, author, subject in commits:
            subj = subject.replace("|", "\\|")
            lines.append(f"| {tm} | {author} | {subj} |")
    else:
        lines.append("| — | — | 当日无提交 |")
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    by_day: dict[str, list[tuple[str, str, str]]] = defaultdict(list)
    for row in _run_git_log():
        by_day[row[0]].append(row)

    report_files = sorted(REPORT_DIR.glob("20*.md"))
    if not report_files:
        print("no report files")
        return 1

    for path in report_files:
        day = path.stem
        text = _render(day, by_day.get(day, []))
        path.write_text(text, encoding="utf-8")
        print(f"wrote {path.name} ({len(by_day.get(day, []))} commits)")

    # README index
    rows = ["# 试用期工作日报索引", "", "按北京时间（Asia/Shanghai）自然日归档。统一结构：**主要事项 → 遗留事项进度 → 参与人 → 提交明细**。参与人：limiaoyi。", "", "| 日期 | 文件 | 主要事项（摘要） |", "| --- | --- | --- |"]
    for path in report_files:
        day = path.stem
        majors = HANDCRAFTED.get(day, [])
        summary = majors[0][:60] + ("…" if majors and len(majors[0]) > 60 else "") if majors else "—"
        rows.append(f"| {day} | [{day}.md](./{day}.md) | {summary} |")
    (REPORT_DIR / "README.md").write_text("\n".join(rows) + "\n", encoding="utf-8")
    print("wrote README.md")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
