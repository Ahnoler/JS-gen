#!/usr/bin/env python3
"""
Browser Use Agent — main entry point.
Supports --session (interactive multi-turn) mode only.
One-shot workflow mode has been removed; use Session mode with "Run All Phases".
Outputs JSON Lines on stdout for progress reporting.
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
    args = parse_args()
    if not args.session:
        print("--session flag is required. Use --help for usage.", file=sys.stderr)
        sys.exit(1)

    asyncio.run(run_session(args))


if __name__ == "__main__":
    main()
