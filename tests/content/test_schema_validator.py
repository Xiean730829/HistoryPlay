from __future__ import annotations

from pathlib import Path

from content_pipeline.cli import main
from content_pipeline.validation.schema_validator import validate_pack

MANIFEST = """
id: cn.tang.core
version: 0.1.0
schema_version: "1"
language: zh-CN
region:
  id: cn
  label: 中国
time_range:
  start_year: 618
  end_year: 907
  precision: year
required_capabilities:
  - artifact3d
publication_status: draft
"""

ARTIFACT = """
id: cn.tang.artifact.stele
title: 一佛二菩萨造像碑
museum:
  name: Minneapolis Institute of Art
  accession: art/140016
time_range:
  start_year: 678
  end_year: 678
  precision: year
material: 石
category: 纪年造像碑
asset_ids:
  - cn.tang.asset.stele.original
"""


def write_pack(root: Path, *, artifact: str = ARTIFACT) -> Path:
    pack = root / "pack"
    (pack / "artifacts").mkdir(parents=True)
    (pack / "manifest.yaml").write_text(MANIFEST, encoding="utf-8")
    (pack / "artifacts" / "stele.yaml").write_text(artifact, encoding="utf-8")
    return pack


def test_valid_pack_passes(tmp_path: Path) -> None:
    assert validate_pack(write_pack(tmp_path)) == []


def test_missing_required_field_fails(tmp_path: Path) -> None:
    pack = write_pack(tmp_path, artifact="id: cn.tang.artifact.stele\ntitle: 碑\n")
    issues = validate_pack(pack)
    assert issues
    assert any("museum" in issue.message or "required" in issue.message for issue in issues)


def test_cli_validate_rejects_missing_pack(tmp_path: Path) -> None:
    assert main(["validate", "--pack", str(tmp_path / "missing")]) == 2


def test_missing_manifest_fails(tmp_path: Path) -> None:
    pack = tmp_path / "pack"
    pack.mkdir()
    issues = validate_pack(pack)
    assert issues
    assert any("清单" in issue.message for issue in issues)


def test_invalid_yaml_fails(tmp_path: Path) -> None:
    pack = write_pack(tmp_path)
    (pack / "manifest.yaml").write_text("id: [unclosed\n", encoding="utf-8")
    issues = validate_pack(pack)
    assert issues
    assert any("YAML" in issue.message for issue in issues)


def test_relation_list_validates_each_item(tmp_path: Path) -> None:
    pack = write_pack(tmp_path)
    (pack / "relations.yaml").write_text(
        "- id: cn.tang.relation.stele-explains-wuzhou\n"
        "  kind: explanatory\n"
        "  from_id: cn.tang.artifact.stele\n"
        "  to_id: cn.tang.event.wuzhou-690\n"
        "- id: bad\n",
        encoding="utf-8",
    )
    issues = validate_pack(pack)
    assert any("[1]" in issue.message for issue in issues)
