from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GENERATOR = ROOT / "tools" / "dev" / "generate_contracts.py"
TS_OUT = ROOT / "packages" / "contracts-ts" / "src" / "generated.ts"
PY_OUT = ROOT / "packages" / "contracts-python" / "src" / "museum_contracts" / "models.py"


def test_generated_files_are_current() -> None:
    result = subprocess.run(
        [sys.executable, str(GENERATOR), "--check"],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    assert result.returncode == 0, result.stderr or result.stdout


def test_generated_exports_include_session_and_command() -> None:
    ts = TS_OUT.read_text(encoding="utf-8")
    py = PY_OUT.read_text(encoding="utf-8")
    assert "export interface SessionProjection" in ts
    assert "export interface Command" in ts
    assert "class SessionProjection(TypedDict):" in py
    assert "class Command(TypedDict):" in py
