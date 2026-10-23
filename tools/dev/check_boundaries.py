from __future__ import annotations

import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FORBIDDEN = {
    "domain/session": {"aiohttp", "sqlite3", "mcp", "react"},
    "domain/story": {"aiohttp", "sqlite3", "mcp", "react"},
    "adapters/mcp": {"museum.domain", "museum.adapters.sqlite"},
}


def main() -> int:
    violations: list[str] = []
    source_root = ROOT / "services" / "museum" / "src" / "museum"
    if not source_root.exists():
        print("边界检查通过：尚无领域模块。")
        return 0

    for path in source_root.rglob("*.py"):
        relative = path.relative_to(source_root).as_posix()
        for module_path, forbidden in FORBIDDEN.items():
            if not relative.startswith(module_path + "/"):
                continue
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            for node in ast.walk(tree):
                module = node.module if isinstance(node, ast.ImportFrom) else None
                names = [alias.name for alias in node.names] if isinstance(node, ast.Import) else []
                imported = ([module] if module else []) + names
                for name in imported:
                    if any(name == blocked or name.startswith(blocked + ".") for blocked in forbidden):
                        violations.append(f"{path.relative_to(ROOT)}:{node.lineno}: 禁止依赖 {name}")

    if violations:
        print("\n".join(violations))
        return 1
    print("Python导入边界检查通过。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
