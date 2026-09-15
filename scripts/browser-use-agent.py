#!/usr/bin/env python3
"""
browser-use-agent 启动脚本。

本脚本是 browser-use-agent 的入口点，直接调用 scripts.main.main() 函数。
用于从命令行启动 agent 会话模式。
"""
from scripts.main import main

if __name__ == "__main__":
    main()
