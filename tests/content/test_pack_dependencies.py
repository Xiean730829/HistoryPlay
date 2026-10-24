from __future__ import annotations

import json
from pathlib import Path

from content_pipeline.build.compiler import compile_pack
from content_pipeline.build.pack_writer import read_index, write_immutable_pack
from content_pipeline.cli import main
from content_pipeline.validation.dependencies import dependency_hash
from test_reference_validator import write_pack


def _foreign_pack(root: Path, package_id: str = "iq.abbasid.core") -> Path:
    pack = write_pack(root)
    for path in pack.rglob("*.yaml"):
        path.write_text(
            path.read_text(encoding="utf-8").replace("cn.tang.", "iq.abbasid."),
            encoding="utf-8",
        )
    manifest = pack / "manifest.yaml"
    manifest.write_text(
        manifest.read_text(encoding="utf-8").replace("iq.abbasid.core", package_id),
        encoding="utf-8",
    )
    return pack


def _declare_dependency(pack: Path, package_id: str, version: str = "0.1.0") -> None:
    manifest = pack / "manifest.yaml"
    manifest.write_text(
        manifest.read_text(encoding="utf-8")
        + f"dependencies:\n  - pack_id: {package_id}\n    version: {version}\n",
        encoding="utf-8",
    )


def _add_comparison(pack: Path, artifact_id: str) -> None:
    gallery = pack / "galleries" / "main.yaml"
    gallery.write_text(
        """id: cn.tang.gallery.main
title: 唐朝比较展厅
region:
  id: cn
  label: 中国
status: open
default_station_id: cn.tang.station.first
stations:
  - id: cn.tang.station.first
    order: 0
    time_range:
      start_year: 700
      end_year: 800
      precision: range
    placement_basis: 通过明确依赖对照同一时期的器物。
    artifact_id: cn.tang.artifact.stele
    comparison_artifact_ids:
      - """
        + artifact_id
        + "\n",
        encoding="utf-8",
    )


def test_explicit_foreign_pack_reference_compiles_and_is_hashed(tmp_path: Path) -> None:
    tang = write_pack(tmp_path / "tang")
    iraq = _foreign_pack(tmp_path / "iraq")
    _declare_dependency(tang, "iq.abbasid.core")
    _add_comparison(tang, "iq.abbasid.artifact.stele")

    issues, documents = compile_pack(tang, [iraq])
    assert issues == []
    assert documents is not None

    issues, dest = write_immutable_pack(tmp_path / "published", documents, [iraq])
    assert issues == []
    assert dest is not None
    dependency = read_index(dest)["dependencies"][0]
    assert dependency["pack_id"] == "iq.abbasid.core"
    assert dependency["version"] == "0.1.0"
    assert dependency["sha256"] == dependency_hash(iraq)
    assert (dest / "artifacts" / "stele.json").is_file()
    assert json.loads((dest / "manifest.json").read_text(encoding="utf-8"))["dependencies"] == [
        {"pack_id": "iq.abbasid.core", "version": "0.1.0"}
    ]


def test_dependency_must_be_supplied_at_exact_version(tmp_path: Path) -> None:
    tang = write_pack(tmp_path / "tang")
    iraq = _foreign_pack(tmp_path / "iraq")
    _declare_dependency(tang, "iq.abbasid.core", "1.0.0")

    issues, documents = compile_pack(tang, [iraq])

    assert documents is None
    assert any("缺少精确版本 iq.abbasid.core@1.0.0" in issue.message for issue in issues)


def test_cross_pack_reference_without_declared_dependency_fails(tmp_path: Path) -> None:
    tang = write_pack(tmp_path / "tang")
    iraq = _foreign_pack(tmp_path / "iraq")
    _add_comparison(tang, "iq.abbasid.artifact.stele")

    issues, documents = compile_pack(tang, [iraq])

    assert documents is None
    assert any("缺少引用" in issue.message and "iq.abbasid.artifact.stele" in issue.message for issue in issues)


def test_cli_accepts_explicit_dependency_pack(tmp_path: Path) -> None:
    tang = write_pack(tmp_path / "tang")
    iraq = _foreign_pack(tmp_path / "iraq")
    _declare_dependency(tang, "iq.abbasid.core")
    _add_comparison(tang, "iq.abbasid.artifact.stele")

    assert main(
        ["validate", "--pack", str(tang), "--dependency-pack", str(iraq)]
    ) == 0


def test_dependency_cycles_are_rejected(tmp_path: Path) -> None:
    tang = write_pack(tmp_path / "tang")
    iraq = _foreign_pack(tmp_path / "iraq")
    _declare_dependency(tang, "iq.abbasid.core")
    _declare_dependency(iraq, "cn.tang.core")

    issues, documents = compile_pack(tang, [iraq])

    assert documents is None
    assert any("形成循环" in issue.message for issue in issues)
