#!/usr/bin/env python3
"""
Backward-compatible entry point for browser-use-agent.py.
Delegates to scripts.main via absolute import (works when run directly).
"""
import sys
import os

script_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(script_dir)
if parent_dir not in sys.path:
    sys.path.insert(0, parent_dir)

from scripts.main import main

if __name__ == "__main__":
    main()
