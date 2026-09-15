#!/usr/bin/env python3
"""
Browser Use Agent 主入口模块。

本模块是 browser-use-agent 的主入口点，仅支持 --session（交互式多轮）模式。
单次工作流模式已移除，请使用 Session 模式配合"Run All Phases"功能。
标准输出使用 JSON Lines 格式进行进度报告。

用法：
    python -m scripts.main --session --model <model_id> --base-url <url> [选项]
"""
import sys
import asyncio

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')
sys.stdin.reconfigure(encoding='utf-8', errors='replace')

from .agent_utils import (
    parse_args,
    patch_message_manager, patch_planner_prompt, create_llm,
)
from .session_runner import run_session


def main():
    """
    主函数：解析命令行参数并启动会话模式。

    如果未提供 --session 参数，则输出错误信息并退出。
    否则调用 run_session 函数启动交互式会话。
    """
    args = parse_args()
    if not args.session:
        print("--session flag is required. Use --help for usage.", file=sys.stderr)
        sys.exit(1)

    asyncio.run(run_session(args))


if __name__ == "__main__":
    main()
