#!/usr/bin/env python3
"""Characterization: form-engine split scope audit (AST unresolved-name guard).

Born 2026-09-10 from the form_action_engines.py split regression: *_for_replay
wrappers in fill/select/radio engines referenced _replay_engine_store /
_ReplayPageAdapter / _ReplayAutofillStub after those moved to
form_engine_base.py, but only tree_engine.py got the import — call-time
NameError, invisible to import-level wiring checks (modules still import fine;
the bomb only detonates when the wrapper runs).

Guard: parse each split-chain file and flag every ``Name`` **Load** inside any
function body that resolves to neither
  - module scope (imports, module-level bindings, builtins), nor
  - the function's own subtree bindings (params, locals, nested defs), nor
  - any enclosing function's subtree bindings (closures).
Star imports disqualify a file (static resolution impossible). Lazy-annotation
files (``from __future__ import annotations``) get annotation/default subtrees
pruned — annotation-only names never evaluate at runtime.

Change the rule ONLY with the corresponding import fix in the same commit;
this file pins the split chain's import hygiene.
"""
from __future__ import annotations

import ast
import builtins
import sys
from pathlib import Path

FILES = [
    "form_engine_base.py",
    "login_engine.py",
    "fill_engine.py",
    "select_engine.py",
    "radio_engine.py",
    "tree_engine.py",
    "form_action_engines.py",
    "_replay.py",
]

MODULE_DUNDERS = {
    "__name__", "__file__", "__doc__", "__package__",
    "__spec__", "__loader__", "__builtins__",
}


def find_root() -> Path:
    p = Path(__file__).resolve().parent
    for _ in range(6):
        if (p / "scripts" / "controller" / "actions" / "form_engine_base.py").exists():
            return p
        p = p.parent
    raise SystemExit("repo root not found")


def alias_binds(alias: ast.alias) -> list[str]:
    if alias.asname:
        return [alias.asname]
    return [alias.name.split(".")[0]]


def module_scope(tree: ast.Module) -> set[str]:
    names = set(dir(builtins)) | MODULE_DUNDERS
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            for a in node.names:
                if a.name != "*":
                    names.update(alias_binds(a))
    stack = list(tree.body)
    while stack:
        node = stack.pop()
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            names.add(node.name)
        for child in ast.iter_child_nodes(node):
            if isinstance(child, ast.Name) and isinstance(child.ctx, ast.Store):
                names.add(child.id)
        if isinstance(node, (ast.If, ast.Try, ast.ExceptHandler, ast.With, ast.AsyncWith,
                             ast.For, ast.AsyncFor, ast.While)):
            stack.extend(ast.iter_child_nodes(node))
    return names


def subtree_stores(fn) -> set[str]:
    stores: set[str] = set()
    for node in ast.walk(fn):
        if isinstance(node, ast.arg):
            stores.add(node.arg)
        elif isinstance(node, ast.Name) and isinstance(node.ctx, (ast.Store, ast.Del)):
            stores.add(node.id)
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            stores.add(node.name)
        elif isinstance(node, (ast.Global, ast.Nonlocal)):
            stores.update(node.names)
        elif isinstance(node, ast.ExceptHandler) and node.name:
            stores.add(node.name)
    return stores


def has_future_annotations(tree: ast.Module) -> bool:
    for node in tree.body:
        if isinstance(node, ast.ImportFrom) and node.module == "__future__":
            for a in node.names:
                if a.name == "annotations":
                    return True
    return False


def iter_nodes_pruned(root: ast.AST, skip_annotations: bool):
    """Yield nodes in root's subtree; prune annotation/default subtrees when lazy annotations are on."""
    todo = [root]
    while todo:
        node = todo.pop()
        yield node
        children = list(ast.iter_child_nodes(node))
        if skip_annotations:
            if isinstance(node, ast.arg):
                continue
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.returns is not None:
                children = [c for c in children if c is not node.returns]
            elif isinstance(node, ast.AnnAssign):
                children = [c for c in children if c is not node.annotation]
            elif isinstance(node, ast.arguments):
                children = [c for c in children
                            if c not in node.defaults and c not in node.kw_defaults]
        todo.extend(children)


def enclosing_chain(tree: ast.Module, fn) -> list:
    """Outermost-to-innermost chain of enclosing FunctionDefs for fn."""
    parents: dict[int, ast.AST] = {}
    for node in ast.walk(tree):
        for child in ast.iter_child_nodes(node):
            parents[id(child)] = node
    chain = []
    cur = parents.get(id(fn))
    while cur is not None:
        if isinstance(cur, (ast.FunctionDef, ast.AsyncFunctionDef)):
            chain.insert(0, cur)
        cur = parents.get(id(cur))
    return chain


def audit_file(path: Path) -> list[str]:
    src = path.read_text(encoding="utf-8")
    tree = ast.parse(src, filename=str(path))
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)) and any(a.name == "*" for a in node.names):
            return [f"{path.name}: star-import present — file skipped (cannot statically resolve)"]
    mod = module_scope(tree)
    lazy_ann = has_future_annotations(tree)
    failures: list[str] = []
    for fn in [n for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]:
        allowed = set(mod) | subtree_stores(fn)
        for anc in enclosing_chain(tree, fn):
            allowed |= subtree_stores(anc)
        for node in iter_nodes_pruned(fn, lazy_ann):
            if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load):
                if node.id not in allowed:
                    failures.append(f"{path.name}:{node.lineno}: name '{node.id}' unresolved in function scope")
    return failures


def main() -> int:
    root = find_root()
    failures: list[str] = []
    for name in FILES:
        path = root / "scripts" / "controller" / "actions" / name
        if not path.exists():
            failures.append(f"{name}: FILE MISSING")
            continue
        failures.extend(audit_file(path))
    if failures:
        print("FAIL form-engine split scope audit:")
        for f in dict.fromkeys(failures):
            print("  " + f)
        return 1
    print(f"PASS scope audit over {len(FILES)} split-chain files (all function-body loads resolve)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
