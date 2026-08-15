#!/usr/bin/env python3
"""Characterize login(): fail closed on missing user/pass/button (not always ok-login)."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
form = (
    (ROOT / "scripts/controller/actions/form_action_engines.py").read_text(encoding="utf-8")
    + "\n"
    + (ROOT / "scripts/controller/actions/_form.py").read_text(encoding="utf-8")
)


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def login_body() -> str:
    start = form.find("async def login(")
    assert_true(start >= 0, "login() present")
    nxt = form.find("\n    @controller.action", start + 10)
    return form[start : nxt if nxt > 0 else start + 3500]


def main() -> int:
    body = login_body()
    assert_true("err-login" in body, "failure result uses err-login prefix")
    assert_true("return _err(" in body, "failure returns _err")
    assert_true("_is_ok_result" in body, "username/password checked with _is_ok_result")
    assert_true("clicked != 'ok'" in body or 'clicked != "ok"' in body, "button not-found fails")
    rec = body.find("_record_action")
    err = body.find("return _err(")
    assert_true(err >= 0 and rec >= 0, "both _err return and _record_action present")
    assert_true(err < rec, "fail before _record_action / success wait")
    wait = body.find("wait_for_timeout(3000)")
    assert_true(wait > err, "3s wait only on success path (after fail return)")
    assert_true("return _ok(" in body and "ok-login" in body, "success still ok-login")
    assert_true("if captcha:" in body, "captcha fill remains optional")
    print("characterize-login-action: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
