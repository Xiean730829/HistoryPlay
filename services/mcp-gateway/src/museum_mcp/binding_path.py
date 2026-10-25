from __future__ import annotations

from pathlib import Path


def require_absolute_binding_path(value: str | Path) -> Path:
    """Return the configured binding file without cwd-dependent guessing."""
    path = Path(value).expanduser()
    if not path.is_absolute():
        raise ValueError("MUSEUM_MCP_BINDING_FILE必须使用同一个绝对路径")
    return path.resolve()
