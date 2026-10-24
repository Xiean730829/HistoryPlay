from __future__ import annotations

from pathlib import Path

from content_pipeline.cli import main
from content_pipeline.validation.reference_validator import validate_references

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
fact_card_ids:
  - cn.tang.fact.stele.dated-678
story_entry_ids:
  - cn.tang.story.stele-observation
"""

ASSET = """
id: cn.tang.asset.stele.original
kind: model3d
format: glb
sha256: 9df4392c5d16e92fd704737f4037be19b55e69b28635ec3d47142e5180d87ed4
byte_size: 4855856
license:
  spdx: CC0-1.0
  attribution: Minneapolis Institute of Art
"""

SOURCE = """
id: cn.tang.source.mia.stele-record
kind: museum_record
title: Mia 造像碑馆藏记录
locator:
  label: Minneapolis Institute of Art art/140016
"""

FACT = """
id: cn.tang.fact.stele.dated-678
claim: 馆方将此造像碑断代为678年。
grade: F
applicable_time:
  start_year: 678
  end_year: 678
  precision: year
source_ids:
  - cn.tang.source.mia.stele-record
"""

STORY = """
id: cn.tang.story.stele-observation
title: 造像碑三片段观察
entry_node_id: cn.tang.node.stele-observation.01
node_ids:
  - cn.tang.node.stele-observation.01
  - cn.tang.node.stele-observation.02
artifact_id: cn.tang.artifact.stele
"""

NODE_01 = """
id: cn.tang.node.stele-observation.01
story_id: cn.tang.story.stele-observation
fact_grade: F
narration: A single authored background passage for the stele.
allowed_actions:
  - continue_story
exits:
  - action: continue_story
    target_node_id: cn.tang.node.stele-observation.02
"""

NODE_02 = """
id: cn.tang.node.stele-observation.02
story_id: cn.tang.story.stele-observation
fact_grade: F
allowed_actions:
  - return_to_exhibit
exits:
  - action: return_to_exhibit
    target_node_id: cn.tang.node.stele-observation.01
"""


def write_pack(
    root: Path,
    *,
    artifact: str = ARTIFACT,
    extra_asset: str | None = None,
    extra_assets: list[str] | None = None,
) -> Path:
    pack = root / "pack"
    (pack / "artifacts").mkdir(parents=True)
    (pack / "assets").mkdir()
    (pack / "sources").mkdir()
    (pack / "facts").mkdir()
    (pack / "stories").mkdir()
    (pack / "nodes").mkdir()
    (pack / "galleries").mkdir()
    (pack / "manifest.yaml").write_text(MANIFEST, encoding="utf-8")
    (pack / "artifacts" / "stele.yaml").write_text(artifact, encoding="utf-8")
    (pack / "assets" / "stele.yaml").write_text(ASSET, encoding="utf-8")
    (pack / "sources" / "mia.yaml").write_text(SOURCE, encoding="utf-8")
    (pack / "facts" / "dated.yaml").write_text(FACT, encoding="utf-8")
    (pack / "stories" / "observation.yaml").write_text(STORY, encoding="utf-8")
    (pack / "nodes" / "01.yaml").write_text(NODE_01, encoding="utf-8")
    (pack / "nodes" / "02.yaml").write_text(NODE_02, encoding="utf-8")
    if extra_asset is not None:
        (pack / "assets" / "extra.yaml").write_text(extra_asset, encoding="utf-8")
    for index, asset in enumerate(extra_assets or [], start=1):
        (pack / "assets" / f"extra-{index}.yaml").write_text(asset, encoding="utf-8")
    return pack


def test_complete_pack_references_pass(tmp_path: Path) -> None:
    assert validate_references(write_pack(tmp_path)) == []


def test_missing_asset_reference_fails(tmp_path: Path) -> None:
    pack = write_pack(
        tmp_path,
        artifact=ARTIFACT.replace("cn.tang.asset.stele.original", "cn.tang.asset.missing"),
    )
    issues = validate_references(pack)
    assert any("缺少引用" in issue.message and "cn.tang.asset.missing" in issue.message for issue in issues)


def test_explicit_artifact_presentation_bindings_pass(tmp_path: Path) -> None:
    artifact = ARTIFACT.replace(
        "story_entry_ids:",
        """presentation:
  preview_asset_id: cn.tang.asset.stele.preview
  display:
    kind: model3d
    asset_id: cn.tang.asset.stele.display
  default_camera:
    orbit: three-quarter-front
    target_note: Center the inscription.
  teaser: A dated stele that records a donor's vow.
  background_node_id: cn.tang.node.stele-observation.01
story_entry_ids:""",
    )
    preview = ASSET.replace("cn.tang.asset.stele.original", "cn.tang.asset.stele.preview").replace(
        "kind: model3d\nformat: glb", "kind: preview\nformat: jpg"
    )
    display = ASSET.replace("cn.tang.asset.stele.original", "cn.tang.asset.stele.display").replace(
        "byte_size: 4855856", "byte_size: 123456"
    ).replace("license:", "lod: display\nlicense:")
    audio = ASSET.replace("cn.tang.asset.stele.original", "cn.tang.asset.stele.audio").replace(
        "kind: model3d\nformat: glb", "kind: audio\nformat: mp3"
    ).replace("byte_size: 4855856", "byte_size: 65432")
    pack = write_pack(tmp_path, artifact=artifact, extra_assets=[preview, display, audio])
    node = pack / "nodes" / "01.yaml"
    node.write_text(
        NODE_01.replace(
            "narration:",
            "presentation:\n  audio_asset_id: cn.tang.asset.stele.audio\nnarration:",
        ),
        encoding="utf-8",
    )

    assert validate_references(pack) == []


def test_artifact_semantic_bindings_require_existing_typed_references(tmp_path: Path) -> None:
    artifact = ARTIFACT.replace(
        "story_entry_ids:",
        """presentation:
  preview_asset_id: cn.tang.asset.missing-preview
  display:
    kind: photo
    asset_id: cn.tang.asset.stele.original
  teaser: A short introduction.
  background_node_id: cn.tang.node.missing
story_entry_ids:""",
    )
    issues = validate_references(write_pack(tmp_path, artifact=artifact))

    assert any("preview_asset_id 缺少引用" in issue.message for issue in issues)
    assert any("background_node_id 缺少引用" in issue.message for issue in issues)
    assert any("display.kind 与资产类型不一致" in issue.message for issue in issues)


def test_artifact_background_node_must_belong_to_its_story(tmp_path: Path) -> None:
    artifact = ARTIFACT.replace(
        "story_entry_ids:",
        """presentation:
  preview_asset_id: cn.tang.asset.stele.original
  display:
    kind: model3d
    asset_id: cn.tang.asset.stele.original
  teaser: A short introduction.
  background_node_id: cn.tang.node.stele-observation.02
story_entry_ids:""",
    )

    pack = write_pack(tmp_path, artifact=artifact)
    story = pack / "stories" / "observation.yaml"
    story.write_text(STORY.replace("cn.tang.artifact.stele", "cn.tang.artifact.other"), encoding="utf-8")

    issues = validate_references(pack)

    assert any("展示版或移动版模型" in issue.message for issue in issues)
    assert any("必须属于该文物的故事" in issue.message for issue in issues)


def test_story_narration_audio_requires_audio_asset(tmp_path: Path) -> None:
    pack = write_pack(tmp_path)
    node = pack / "nodes" / "01.yaml"
    node.write_text(
        NODE_01.replace(
            "narration:",
            "presentation:\n  audio_asset_id: cn.tang.asset.stele.original\nnarration:",
        ),
        encoding="utf-8",
    )

    issues = validate_references(pack)

    assert any("audio_asset_id 需要音频资产" in issue.message for issue in issues)


def test_wrong_kind_reference_fails(tmp_path: Path) -> None:
    pack = write_pack(
        tmp_path,
        artifact=ARTIFACT.replace("cn.tang.story.stele-observation", "cn.tang.artifact.stele"),
    )
    issues = validate_references(pack)
    assert any("需要故事" in issue.message for issue in issues)


def test_duplicate_id_fails(tmp_path: Path) -> None:
    pack = write_pack(
        tmp_path,
        extra_asset=ASSET.replace("cn.tang.asset.stele.original", "cn.tang.artifact.stele"),
    )
    issues = validate_references(pack)
    assert any("重复的标识" in issue.message for issue in issues)


def test_foreign_namespace_fails(tmp_path: Path) -> None:
    pack = write_pack(
        tmp_path,
        extra_asset=ASSET.replace("cn.tang.asset.stele.original", "iq.abbasid.asset.bowl"),
    )
    issues = validate_references(pack)
    assert any("命名空间" in issue.message for issue in issues)


def test_alias_shared_by_different_artifacts_fails(tmp_path: Path) -> None:
    pack = write_pack(tmp_path)
    (pack / "artifacts" / "coin.yaml").write_text(
        """
id: cn.tang.artifact.coin
title: Coin two
aliases:
  - Shared alias
museum:
  name: Museum
  accession: coin-1
time_range:
  start_year: 718
  end_year: 732
  precision: range
material: copper
category: coin
asset_ids: []
""",
        encoding="utf-8",
    )
    (pack / "artifacts" / "stele.yaml").write_text(
        ARTIFACT.replace("title: 一佛二菩萨造像碑", "title: Shared alias"), encoding="utf-8"
    )
    issues = validate_references(pack)
    assert any("别名冲突" in issue.message and "Shared alias" in issue.message for issue in issues)


def test_artifact_has_only_one_primary_gallery_station(tmp_path: Path) -> None:
    pack = write_pack(tmp_path)
    (pack / "galleries" / "main.yaml").write_text(
        """
id: cn.tang.gallery.main
title: 唐朝长廊
region:
  id: cn
  label: 中国
status: open
default_station_id: cn.tang.station.first
stations:
  - id: cn.tang.station.first
    order: 0
    time_range:
      start_year: 678
      end_year: 678
      precision: year
    placement_basis: 长廊入口。
    artifact_id: cn.tang.artifact.stele
  - id: cn.tang.station.second
    order: 1
    time_range:
      start_year: 679
      end_year: 700
      precision: range
    placement_basis: 重复主展位测试。
    artifact_id: cn.tang.artifact.stele
""",
        encoding="utf-8",
    )
    issues = validate_references(pack)
    assert any("主展品只能有一个展位" in issue.message for issue in issues)


def test_cli_validate_rejects_missing_reference(tmp_path: Path) -> None:
    pack = write_pack(
        tmp_path,
        artifact=ARTIFACT.replace("cn.tang.asset.stele.original", "cn.tang.asset.missing"),
    )
    assert main(["validate", "--pack", str(pack)]) == 1
