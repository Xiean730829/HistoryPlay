from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from content_pipeline.importers.story_assets import (
    StoryAssetImportError,
    build_story_asset_candidate,
    import_story_asset_candidate,
)


STORY_ID = "cn.tang.story.votive-stele"
NODE_ID = "cn.tang.node.votive-stele.01"
OTHER_NODE_ID = "cn.tang.node.votive-stele.02"
ASSET_ID = "cn.tang.scene.t03.evidence-table.v1"


@pytest.fixture
def source_root(tmp_path: Path) -> Path:
    image = b"\x89PNG\r\n\x1a\n" + b"candidate image bytes"
    image_path = tmp_path / "reused" / "evidence-table.png"
    image_path.parent.mkdir()
    image_path.write_bytes(image)
    (tmp_path / "manifest.local.json").write_text(
        json.dumps(
            {
                "assets": [
                    {
                        "asset_id": ASSET_ID,
                        "title": "石头与纸上的证据",
                        "relative_path": "reused/evidence-table.png",
                        "path": str(image_path),
                        "status": "available_previous_batch",
                        "sha256": hashlib.sha256(image).hexdigest(),
                        "review_status": "history_and_art_direction_pending",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    (tmp_path / "replacement-assets.json").write_text(
        json.dumps(
            {
                "replacements": {
                    name: {"review_key": f"{name}-v2"}
                    for name in (
                        "t05-character",
                        "a02-road",
                        "r01-color",
                        "r06-gesture",
                        "r07-door",
                        "r08-fragment",
                        "t06-ledger",
                    )
                }
            }
        ),
        encoding="utf-8",
    )
    content = tmp_path / "content"
    content.mkdir()
    (content / "scene-bindings.json").write_text(
        json.dumps({"artifact_story_assets": {"A04": ASSET_ID}}), encoding="utf-8"
    )
    return tmp_path


@pytest.fixture
def pack_dir(tmp_path: Path) -> Path:
    pack = tmp_path / "author-pack"
    (pack / "stories").mkdir(parents=True)
    (pack / "nodes").mkdir()
    (pack / "stories" / "votive-stele.yaml").write_text(
        f"id: {STORY_ID}\nnode_ids:\n  - {NODE_ID}\n", encoding="utf-8"
    )
    (pack / "nodes" / "votive-stele-01.yaml").write_text(
        f"id: {NODE_ID}\nstory_id: {STORY_ID}\n", encoding="utf-8"
    )
    return pack


def test_import_keeps_hash_review_state_and_story_node_binding(
    source_root: Path, pack_dir: Path
):
    result = build_story_asset_candidate(
        source_root=source_root,
        pack_dir=pack_dir,
        binding_key="A04",
        story_id=STORY_ID,
        node_ids=[NODE_ID],
    )

    asset = result["assets"][0]
    assert result["status"] == "candidate_not_published"
    assert result["node_bindings"] == [{"node_id": NODE_ID, "asset_id": ASSET_ID}]
    assert asset["sha256"] == hashlib.sha256(
        b"\x89PNG\r\n\x1a\n" + b"candidate image bytes"
    ).hexdigest()
    assert asset["review"]["review_status"] == "history_and_art_direction_pending"
    assert "D:" not in json.dumps(result)


@pytest.mark.parametrize(
    "superseded_name",
    [
        "t05-character",
        "a02-road",
        "r01-color",
        "r06-gesture",
        "r07-door",
        "r08-fragment",
        "t06-ledger",
    ],
)
def test_import_rejects_superseded_original(
    source_root: Path, pack_dir: Path, superseded_name: str
):
    manifest_path = source_root / "manifest.local.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["assets"][0]["name"] = superseded_name
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    bindings_path = source_root / "content" / "scene-bindings.json"
    bindings_path.write_text(
        json.dumps({"artifact_story_assets": {"T05": ASSET_ID}}), encoding="utf-8"
    )

    with pytest.raises(StoryAssetImportError, match="已被替换"):
        build_story_asset_candidate(
            source_root=source_root,
            pack_dir=pack_dir,
            binding_key="T05",
            story_id=STORY_ID,
            node_ids=[NODE_ID],
        )


def test_import_rejects_character_reference_sheet(source_root: Path, pack_dir: Path):
    manifest_path = source_root / "manifest.local.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["assets"][0]["asset_id"] = "cn.tang.art.t03.character-reference.v1"
    manifest["assets"][0]["title"] = "许宁角色设定"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    bindings_path = source_root / "content" / "scene-bindings.json"
    bindings_path.write_text(
        json.dumps(
            {"artifact_story_assets": {"A04": "cn.tang.art.t03.character-reference.v1"}}
        ),
        encoding="utf-8",
    )

    with pytest.raises(StoryAssetImportError, match="参考图不能直接"):
        build_story_asset_candidate(
            source_root=source_root,
            pack_dir=pack_dir,
            binding_key="A04",
            story_id=STORY_ID,
            node_ids=[NODE_ID],
        )


def test_import_rejects_image_extension_with_non_image_bytes(
    source_root: Path, pack_dir: Path
):
    image_path = source_root / "reused" / "evidence-table.png"
    image_path.write_bytes(b"not a PNG")
    manifest_path = source_root / "manifest.local.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["assets"][0]["sha256"] = hashlib.sha256(b"not a PNG").hexdigest()
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    with pytest.raises(StoryAssetImportError, match="扩展名与图片文件格式不符"):
        build_story_asset_candidate(
            source_root=source_root,
            pack_dir=pack_dir,
            binding_key="A04",
            story_id=STORY_ID,
            node_ids=[NODE_ID],
        )


def test_import_rejects_node_not_referenced_by_story(source_root: Path, pack_dir: Path):
    with pytest.raises(StoryAssetImportError, match="未被目标故事引用"):
        build_story_asset_candidate(
            source_root=source_root,
            pack_dir=pack_dir,
            binding_key="A04",
            story_id=STORY_ID,
            node_ids=[OTHER_NODE_ID],
        )


@pytest.mark.parametrize("relative_path", ["../outside.png", "C:/outside.png"])
def test_import_rejects_paths_outside_source_root(
    source_root: Path, pack_dir: Path, relative_path: str
):
    manifest_path = source_root / "manifest.local.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["assets"][0]["relative_path"] = relative_path
    manifest["assets"][0].pop("path")
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    with pytest.raises(StoryAssetImportError, match="相对路径|路径越界"):
        build_story_asset_candidate(
            source_root=source_root,
            pack_dir=pack_dir,
            binding_key="A04",
            story_id=STORY_ID,
            node_ids=[NODE_ID],
        )


def test_import_rejects_hash_mismatch(source_root: Path, pack_dir: Path):
    manifest_path = source_root / "manifest.local.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["assets"][0]["sha256"] = "0" * 64
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    with pytest.raises(StoryAssetImportError, match="SHA-256"):
        build_story_asset_candidate(
            source_root=source_root,
            pack_dir=pack_dir,
            binding_key="A04",
            story_id=STORY_ID,
            node_ids=[NODE_ID],
        )


def test_import_writes_atomically_and_wont_overwrite_review_evidence(
    source_root: Path, pack_dir: Path, tmp_path: Path
):
    output = tmp_path / "candidate.json"
    import_story_asset_candidate(
        source_root=source_root,
        pack_dir=pack_dir,
        output_file=output,
        binding_key="A04",
        story_id=STORY_ID,
        node_ids=[NODE_ID],
    )
    saved = json.loads(output.read_text(encoding="utf-8"))
    assert saved["status"] == "candidate_not_published"
    with pytest.raises(StoryAssetImportError, match="已存在"):
        import_story_asset_candidate(
            source_root=source_root,
            pack_dir=pack_dir,
            output_file=output,
            binding_key="A04",
            story_id=STORY_ID,
            node_ids=[NODE_ID],
        )
