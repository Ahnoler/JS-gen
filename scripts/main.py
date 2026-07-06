#!/usr/bin/env python3
"""
Browser Use Agent — main entry point.
Supports --task (single task), --workflow (multi-phase workflow), and --session (interactive) modes.
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
from .form_rules import load_rules
from .session_runner import run_session
from .workflow_runner import run_workflow, run_single_task


def main():
    args = parse_args()
    if not args.task and not args.workflow and not args.session:
        print("Either --task, --workflow, or --session is required", file=sys.stderr)
        sys.exit(1)

    if args.session:
        asyncio.run(run_session(args))
        return

    # Shared setup for workflow / single-task modes
    patch_message_manager()
    patch_planner_prompt()
    llm = create_llm(args.model, args.base_url, getattr(args, 'api_key', None))
    form_rules = load_rules()

    if args.workflow:
        asyncio.run(run_workflow(args, llm, form_rules))
    else:
        asyncio.run(run_single_task(args, llm, form_rules))


if __name__ == "__main__":
    main()
