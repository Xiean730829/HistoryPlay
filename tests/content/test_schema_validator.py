from __future__ import annotations

import json
from pathlib import Path

from content_pipeline.build.compiler import compile_pack
from content_pipeline.cli import main
from content_pipeline.validation.reference_validator import validate_references
from content_pipeline.validation.schema_validator import validate_document, validate_pack

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
asset_ids: []
"""

GALLERY = """
id: cn.tang.gallery.main
title: 唐朝长廊
region:
  id: cn
  label: 中国
status: open
default_station_id: cn.tang.station.stele
stations:
  - id: cn.tang.station.stele
    order: 0
    time_range:
      start_year: 678
      end_year: 690
      precision: range
    placement_basis: 入口展位采用有纪年依据的造像碑。
    artifact_id: cn.tang.artifact.stele
"""


def write_pack(root: Path, *, artifact: str = ARTIFACT) -> Path:
    pack = root / "pack"
    (pack / "artifacts").mkdir(parents=True)
    (pack / "galleries").mkdir(parents=True)
    (pack / "manifest.yaml").write_text(MANIFEST, encoding="utf-8")
    (pack / "artifacts" / "stele.yaml").write_text(artifact, encoding="utf-8")
    (pack / "galleries" / "tang.yaml").write_text(GALLERY, encoding="utf-8")
    return pack


def test_valid_pack_passes(tmp_path: Path) -> None:
    assert validate_pack(write_pack(tmp_path)) == []


def test_gallery_is_included_in_compiled_pack(tmp_path: Path) -> None:
    issues, documents = compile_pack(write_pack(tmp_path))
    assert issues == []
    assert documents is not None
    assert "galleries/tang.json" in documents


def test_gallery_examples_validate() -> None:
    examples = Path(__file__).resolve().parents[2] / "contracts" / "examples" / "v1"
    for name in ("gallery.valid-tang.json", "gallery.valid-unopened-song.json"):
        document = json.loads((examples / name).read_text(encoding="utf-8"))
        assert validate_document("gallery", document) == []


def test_gallery_requires_existing_default_station(tmp_path: Path) -> None:
    pack = write_pack(tmp_path)
    gallery = pack / "galleries" / "tang.yaml"
    gallery.write_text(GALLERY.replace("cn.tang.station.stele", "cn.tang.station.missing", 1), encoding="utf-8")
    issues = validate_references(pack)
    assert any("默认展位不属于本展厅" in issue.message for issue in issues)


def test_gallery_references_existing_artifacts(tmp_path: Path) -> None:
    pack = write_pack(tmp_path)
    gallery = pack / "galleries" / "tang.yaml"
    gallery.write_text(
        GALLERY.replace("order: 0", "order: 1").replace(
            "cn.tang.artifact.stele", "cn.tang.artifact.missing"
        ),
        encoding="utf-8",
    )
    issues = validate_references(pack)
    assert any("缺少引用：cn.tang.artifact.missing" in issue.message for issue in issues)


def test_gallery_requires_unique_station_order(tmp_path: Path) -> None:
    pack = write_pack(tmp_path)
    gallery = pack / "galleries" / "tang.yaml"
    gallery.write_text(
        GALLERY.replace(
            "  - id: cn.tang.station.stele\n    order: 0",
            "  - id: cn.tang.station.stele\n    order: 0\n"
            "  - id: cn.tang.station.second\n    order: 0",
        ),
        encoding="utf-8",
    )
    issues = validate_references(pack)
    assert any("展位顺序重复：0" in issue.message for issue in issues)


def test_gallery_station_ids_share_the_pack_namespace_and_are_unique(tmp_path: Path) -> None:
    pack = write_pack(tmp_path)
    gallery = pack / "galleries" / "tang.yaml"
    gallery.write_text(GALLERY.replace("id: cn.tang.station.stele", "id: cn.tang.artifact.stele"), encoding="utf-8")
    issues = validate_references(pack)
    assert any("重复的标识：cn.tang.artifact.stele" in issue.message for issue in issues)


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
