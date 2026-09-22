"""Use an installed Playwright browser whose directory starts with the default prefix.

The Python package records one revision (for example chromium_headless_shell-1217).
launch() without an executable path only looks at that directory. This hook
fills executable_path from any directory under the browsers root that starts
with the same prefix. A matching directory is enough; the revision suffix is
not required. When several directories match, the name-sorted first one that
contains the executable is used.
"""
import os
from pathlib import Path

_HEADLESS_SHELL_REL = (
    ("chrome-headless-shell-win64", "chrome-headless-shell.exe"),
    ("chrome-headless-shell-linux64", "chrome-headless-shell"),
    ("chrome-headless-shell-mac-x64", "chrome-headless-shell"),
    ("chrome-headless-shell-mac-arm64", "chrome-headless-shell"),
)
_CHROMIUM_REL = (
    ("chrome-win64", "chrome.exe"),
    ("chrome-win", "chrome.exe"),
    ("chrome-linux64", "chrome"),
    ("chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"),
)


def browsers_roots():
    """Directories Playwright stores browser builds in."""
    roots = []
    env = os.environ.get("PLAYWRIGHT_BROWSERS_PATH")
    if env and env != "0":
        roots.append(Path(env))
    local = os.environ.get("LOCALAPPDATA")
    if local:
        roots.append(Path(local) / "ms-playwright")
    roots.append(Path.home() / ".cache" / "ms-playwright")
    seen = set()
    out = []
    for root in roots:
        key = str(root)
        if key in seen:
            continue
        seen.add(key)
        out.append(root)
    return out


def _executable_in(directory, relative_paths):
    for parts in relative_paths:
        candidate = directory.joinpath(*parts)
        if candidate.is_file():
            return str(candidate)
    return None


def find_by_prefix(headless=True):
    """Return an executable under the default prefix, or None."""
    prefix = "chromium_headless_shell-" if headless else "chromium-"
    relatives = _HEADLESS_SHELL_REL if headless else _CHROMIUM_REL
    matches = []
    for root in browsers_roots():
        if not root.is_dir():
            continue
        for child in root.iterdir():
            if child.is_dir() and child.name.startswith(prefix):
                matches.append(child)
    for directory in sorted(matches, key=lambda path: path.name):
        exe = _executable_in(directory, relatives)
        if exe:
            return exe
    return None


def _apply(kwargs):
    if kwargs.get("executable_path") or kwargs.get("channel"):
        return
    headless = kwargs.get("headless")
    exe = find_by_prefix(headless is not False)
    if exe:
        kwargs["executable_path"] = exe


def _patch_class(cls, is_async):
    if cls is None or getattr(cls, "_jsgen_prefix_launch", False):
        return
    launch = cls.launch
    if is_async:
        async def wrapped(self, *args, **kwargs):
            _apply(kwargs)
            return await launch(self, *args, **kwargs)
    else:
        def wrapped(self, *args, **kwargs):
            _apply(kwargs)
            return launch(self, *args, **kwargs)
    cls.launch = wrapped
    cls._jsgen_prefix_launch = True


def _install():
    try:
        from playwright.async_api._generated import BrowserType as async_browser_type
        from playwright.sync_api._generated import BrowserType as sync_browser_type
    except Exception:
        return
    _patch_class(async_browser_type, True)
    _patch_class(sync_browser_type, False)


_install()
