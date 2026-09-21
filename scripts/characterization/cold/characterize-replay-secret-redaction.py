"""Pin replay credential redaction (executor side) + Python 3.10 syntax compat.

Auth trajectories restore __AUTH_PASSWORD__ to the real password before replay,
so the plan and the executor per-step stderr logs must redact exact secrets.
Also guards against PEP 701 nested same-quote f-strings (3.12+ only) sneaking
back into the replay hot path (README promises 3.10+).
"""
import ast
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

FAILURES = []


def check(cond, msg):
    """Record a failure when cond is falsy."""
    if cond:
        print(f"  OK   {msg}")
    else:
        print(f"  FAIL {msg}")
        FAILURES.append(msg)


def main() -> int:
    from scripts.controller.actions._replay import redact_secrets

    # 1. exact-value masking (same convention as maskTrajectoryStepSecrets)
    check(redact_secrets("value='P@ssw0rd'", ['P@ssw0rd']) == "value='***'",
          'exact secret replaced with ***')
    check(redact_secrets('no secret here', ['P@ssw0rd']) == 'no secret here',
          'unrelated text untouched')
    check(redact_secrets('ab', ['a']) == 'ab',
          'single-char secret ignored (avoids mass false replacement)')
    check(redact_secrets('user=admin pwd=S3cret', ['admin', 'S3cret']) == 'user=*** pwd=***',
          'multiple secrets all masked')
    check(redact_secrets('x', None) == 'x', 'None secret list tolerated')

    # 2. executor wiring: per-step logs redact; secretValues cached + passed
    replay_src = (ROOT / 'scripts/controller/actions/_replay.py').read_text(encoding='utf-8')
    check('redact_secrets(' in replay_src, '_replay.py defines/uses redact_secrets')
    check('secret_values: list | None = None' in replay_src,
          'replay_action_entries accepts secret_values')
    dispatch_src = (ROOT / 'scripts/event_dispatch.py').read_text(encoding='utf-8')
    check("session_state['_replay_secret_values']" in dispatch_src,
          'event_dispatch caches secretValues from replay_plan')
    check('secret_values=session_state.get' in dispatch_src,
          'event_dispatch passes secret_values into replay_action_entries')
    runner_src = (ROOT / 'src/services/trajectory/replay-batch-runner.js').read_text(encoding='utf-8')
    check('function redactSecrets(' in runner_src,
          'replay-batch-runner defines redactSecrets')
    check('secretValues: secretValues || []' in runner_src,
          'replay_plan forwards secretValues to the executor')

    # 3. Python 3.10 compatibility of the replay hot path (no PEP 701).
    for rel in (
        'scripts/controller/actions/_replay.py',
        'scripts/event_dispatch.py',
    ):
        try:
            ast.parse((ROOT / rel).read_text(encoding='utf-8'), filename=rel, feature_version=(3, 10))
            check(True, f'{rel} parses as Python 3.10')
        except SyntaxError as exc:
            check(False, f'{rel} not 3.10-compatible: {exc}')

    if FAILURES:
        print(f"\ncharacterize-replay-secret-redaction: FAILED ({len(FAILURES)})")
        return 1
    print("\ncharacterize-replay-secret-redaction: OK")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
