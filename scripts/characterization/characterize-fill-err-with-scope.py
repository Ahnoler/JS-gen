"""B-6 characterization: fill_form_field err_with scope must be global.

Traj #877 (wet6): branch-local ``from .result_protocol import err_with``
inside ``fill_form_field`` binds ``err_with`` as a *function-local* name.
The field-disabled path calls ``err_with`` without passing through those
import statements -> UnboundLocalError -> the agent never receives the
``err-field-disabled`` structured guidance and burns tries blindly
(119 steps observed in one phase).

The predicate pinned here is exactly the UnboundLocalError condition,
checked with the compiler's own scope analysis (symtable): within
``FillEngine.fill_form_field`` the names ``err_with`` and
``recommend_action_for_kind`` must resolve GLOBAL, never LOCAL.
Also pins the behavioral needles of the four ex-local-import call sites
so the module-level unification cannot silently drop a branch.
"""

import ast
import symtable
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "scripts" / "controller" / "actions" / "fill_engine.py"

failures = []


def check(cond: bool, msg: str) -> None:
    if not cond:
        failures.append(msg)
        print(f"  ✗ {msg}")
    else:
        print(f"  ✓ {msg}")


def find_symbols(tbl: symtable.SymbolTable, name: str) -> list[symtable.SymbolTable]:
    out = []
    if tbl.get_name() == name and tbl.get_type() == "function":
        out.append(tbl)
    for child in tbl.get_children():
        out.extend(find_symbols(child, name))
    return out


def main() -> int:
    src = SRC.read_text(encoding="utf-8")

    # 1. compiler-level scope predicate: no local binding of the
    #    result_protocol names anywhere inside fill_form_field.
    table = symtable.symtable(src, str(SRC), "exec")
    fns = find_symbols(table, "fill_form_field")
    if not fns:
        failures.append("fill_form_field symbol table not found")
        print("  ✗ fill_form_field symbol table not found")
        return 1
    fn = fns[0]
    for nm in ("err_with", "recommend_action_for_kind", "affordances"):
        sym = fn.lookup(nm)
        is_local = sym.is_local() or sym.is_parameter()
        check(
            not is_local,
            f"fill_form_field: '{nm}' must NOT be a function-local name "
            f"(local binding on any path = UnboundLocalError on the others); "
            f"got local={is_local}",
        )
        check(
            sym.is_global(),
            f"fill_form_field: '{nm}' must resolve GLOBAL (module-level import)",
        )

    # 2. module-level import carries all three names exactly once.
    tree = ast.parse(src)
    mod_imports = {
        alias.name
        for node in tree.body
        if isinstance(node, ast.ImportFrom) and node.module == "result_protocol"
        for alias in node.names
    }
    for nm in ("err_with", "affordances", "recommend_action_for_kind"):
        check(
            nm in mod_imports,
            f"module-level 'from .result_protocol import' must include '{nm}'",
        )

    # 3. no branch-local re-imports remain anywhere in the module
    #    (the B-6 defect shape: conditional local import shadowing).
    class LocalImportVisitor(ast.NodeVisitor):
        def __init__(self) -> None:
            self.hits: list[int] = []

        def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
            if node.module == "result_protocol" and node.col_offset != 0:
                self.hits.append(node.lineno)

    visitor = LocalImportVisitor()
    visitor.visit(tree)
    check(
        not visitor.hits,
        f"no indented (function/branch-level) 'from .result_protocol import' "
        f"may remain; found at lines {visitor.hits}",
    )

    # 4. behavior needles: the four former call sites stay intact
    #    (tssc / tree-select rejections + two field-disabled exits).
    for needle in (
        '"err-use-tssc-multi-select"',
        '"err-use-select-tree-option"',
        '"err-field-disabled"',
        "recommend_action_for_kind(kind)",
    ):
        check(needle in src, f"needle present: {needle}")
    check(
        src.count('"err-field-disabled"') >= 2,
        f"both field-disabled exits keep err-field-disabled "
        f"(got {src.count('err-field-disabled')})",
    )

    if failures:
        print(f"FAILED ({len(failures)})")
        return 1
    print("OK: characterize-fill-err-with-scope")
    return 0


if __name__ == "__main__":
    sys.exit(main())
