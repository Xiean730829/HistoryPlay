from __future__ import annotations

import asyncio
import json
from hashlib import sha256
from pathlib import Path

import pytest
import yaml
from aiohttp.test_utils import TestClient, TestServer
from content_pipeline.build.rehearsal_pack import RehearsalPackError, build_rehearsal_pack
from content_pipeline.cli import main
from museum.adapters.assets.local_store import LocalAssetStore
from museum.adapters.content.published_catalog import PackNotFound, PublishedCatalog
from museum.adapters.sqlite.database import SQLiteDatabase
from museum.main import create_app
from test_reference_validator import NODE_01, NODE_02, STORY, write_pack

PACK = Path(__file__).resolve().parents[2] / "content-src" / "packs" / "cn-tang"
PREVIEW_BYTES = b"\x89PNG\r\n\x1a\npreview-bytes"
DISPLAY_BYTES = b"glTF\x02\x00\x00\x00display-bytes"
STORY_IMAGE_BYTES = b"\x89PNG\r\n\x1a\nstory-frame"
STORY_AUDIO_BYTES = b"ID3-narration"
PREVIEW_HASH = sha256(PREVIEW_BYTES).hexdigest()
DISPLAY_HASH = sha256(DISPLAY_BYTES).hexdigest()
STORY_IMAGE_HASH = sha256(STORY_IMAGE_BYTES).hexdigest()
STORY_AUDIO_HASH = sha256(STORY_AUDIO_BYTES).hexdigest()

ARTIFACTS = (
    "cn.tang.artifact.votive-stele",
    "cn.tang.artifact.kaiyuan-coin",
    "cn.tang.artifact.gilt-bronze-bull",
)
SLUGS = ("votive-stele", "kaiyuan-coin", "gilt-bronze-bull")
EXTRA_ARTIFACT = "cn.tang.artifact.extra-rehearsal-exhibit"


def _asset(asset_id: str, *, kind: str, fmt: str, digest: str, size: int, lod: str | None = None) -> str:
    lod_line = f"\nlod: {lod}" if lod else ""
    return (
        f"id: {asset_id}\n"
        f"kind: {kind}\n"
        f"format: {fmt}\n"
        f"sha256: {digest}\n"
        f"byte_size: {size}{lod_line}\n"
        "license:\n"
        "  spdx: CC0-1.0\n"
        "  attribution: test\n"
    )


def _artifact(ident: str, slug: str) -> str:
    return f"""id: {ident}
title: {slug}
museum:
  name: Test Museum
  accession: T-01
time_range:
  start_year: 678
  end_year: 678
  precision: year
material: 石
category: 测试
asset_ids:
  - cn.tang.asset.{slug}.glb
  - cn.tang.asset.{slug}.preview
  - cn.tang.asset.{slug}.display
presentation:
  preview_asset_id: cn.tang.asset.{slug}.preview
  display:
    kind: model3d
    asset_id: cn.tang.asset.{slug}.display
  default_camera:
    orbit: front-upright
    target_note: test
  teaser: 三物联调切片。
  background_node_id: cn.tang.node.{slug}.01
fact_card_ids:
  - cn.tang.fact.stele.dated-678
story_entry_ids:
  - cn.tang.story.{slug}
"""


def _story(slug: str, artifact_id: str) -> str:
    return (
        STORY.replace("cn.tang.story.stele-observation", f"cn.tang.story.{slug}")
        .replace("cn.tang.node.stele-observation.01", f"cn.tang.node.{slug}.01")
        .replace("cn.tang.node.stele-observation.02", f"cn.tang.node.{slug}.02")
        .replace("cn.tang.artifact.stele", artifact_id)
    )


def _node(slug: str, body: str) -> str:
    return body.replace("cn.tang.story.stele-observation", f"cn.tang.story.{slug}").replace(
        "cn.tang.node.stele-observation", f"cn.tang.node.{slug}"
    )


def write_three_pack(root: Path) -> Path:
    pack = write_pack(root)
    (pack / "artifacts" / "stele.yaml").unlink()
    (pack / "stories" / "observation.yaml").unlink()
    (pack / "nodes" / "01.yaml").unlink()
    (pack / "nodes" / "02.yaml").unlink()
    extra_assets: list[str] = []
    for slug, ident in zip(SLUGS, ARTIFACTS, strict=True):
        (pack / "artifacts" / f"{slug}.yaml").write_text(_artifact(ident, slug), encoding="utf-8")
        (pack / "stories" / f"{slug}.yaml").write_text(_story(slug, ident), encoding="utf-8")
        frame_node = _node(slug, NODE_01).replace(
            "fact_grade: F",
            "fact_grade: F\n"
            "presentation:\n"
            "  capability: comic\n"
            "  asset_ids:\n"
            "    - cn.tang.asset.story-frame\n"
            "  audio_asset_id: cn.tang.asset.narration",
        )
        (pack / "nodes" / f"{slug}-01.yaml").write_text(frame_node, encoding="utf-8")
        (pack / "nodes" / f"{slug}-02.yaml").write_text(_node(slug, NODE_02), encoding="utf-8")
        extra_assets.extend(
            [
                _asset(
                    f"cn.tang.asset.{slug}.glb",
                    kind="model3d",
                    fmt="glb",
                    digest="9df4392c5d16e92fd704737f4037be19b55e69b28635ec3d47142e5180d87ed4",
                    size=4855856,
                    lod="source",
                ),
                _asset(
                    f"cn.tang.asset.{slug}.preview",
                    kind="preview",
                    fmt="png",
                    digest=PREVIEW_HASH,
                    size=len(PREVIEW_BYTES),
                ),
                _asset(
                    f"cn.tang.asset.{slug}.display",
                    kind="model3d",
                    fmt="glb",
                    digest=DISPLAY_HASH,
                    size=len(DISPLAY_BYTES),
                    lod="display",
                ),
            ]
        )
    for index, asset in enumerate(extra_assets, start=1):
        (pack / "assets" / f"extra-{index}.yaml").write_text(asset, encoding="utf-8")
    (pack / "assets" / "story-frame.yaml").write_text(
        _asset(
            "cn.tang.asset.story-frame",
            kind="image",
            fmt="png",
            digest=STORY_IMAGE_HASH,
            size=len(STORY_IMAGE_BYTES),
        ),
        encoding="utf-8",
    )
    (pack / "assets" / "narration.yaml").write_text(
        _asset(
            "cn.tang.asset.narration",
            kind="audio",
            fmt="mp3",
            digest=STORY_AUDIO_HASH,
            size=len(STORY_AUDIO_BYTES),
        ),
        encoding="utf-8",
    )
    (pack / "galleries" / "main.yaml").write_text(
        """id: cn.tang.gallery.main
title: 唐朝长廊
region:
  id: cn
  label: 中国
status: open
default_station_id: cn.tang.station.votive-stele
stations:
  - id: cn.tang.station.votive-stele
    order: 0
    time_range:
      start_year: 678
      end_year: 678
      precision: year
    placement_basis: 入口。
    artifact_id: cn.tang.artifact.votive-stele
    side: center
  - id: cn.tang.station.kaiyuan-coin
    order: 1
    time_range:
      start_year: 718
      end_year: 732
      precision: range
    placement_basis: 第二展位。
    artifact_id: cn.tang.artifact.kaiyuan-coin
    side: left
  - id: cn.tang.station.gilt-bronze-bull
    order: 2
    time_range:
      start_year: 700
      end_year: 799
      precision: century
    placement_basis: 第三展位。
    artifact_id: cn.tang.artifact.gilt-bronze-bull
    side: right
""",
        encoding="utf-8",
    )
    return pack


def _sources(tmp_path: Path, mapping: dict[str, Path]) -> Path:
    path = tmp_path / "sources.json"
    path.write_text(
        json.dumps({"schema_version": 1, "sources": {key: str(value) for key, value in mapping.items()}}),
        encoding="utf-8",
    )
    return path


def _runtime_files(tmp_path: Path) -> dict[str, Path]:
    preview = tmp_path / "preview.png"
    display = tmp_path / "display.glb"
    story_image = tmp_path / "story-frame.png"
    narration = tmp_path / "narration.mp3"
    preview.write_bytes(PREVIEW_BYTES)
    display.write_bytes(DISPLAY_BYTES)
    story_image.write_bytes(STORY_IMAGE_BYTES)
    narration.write_bytes(STORY_AUDIO_BYTES)
    mapping: dict[str, Path] = {}
    for slug in SLUGS:
        mapping[f"cn.tang.asset.{slug}.preview"] = preview
        mapping[f"cn.tang.asset.{slug}.display"] = display
    mapping["cn.tang.asset.story-frame"] = story_image
    mapping["cn.tang.asset.narration"] = narration
    return mapping


def _add_extra_exhibit(pack: Path, tmp_path: Path) -> dict[str, Path]:
    slug = "extra-rehearsal-exhibit"
    (pack / "artifacts" / f"{slug}.yaml").write_text(_artifact(EXTRA_ARTIFACT, slug), encoding="utf-8")
    (pack / "stories" / f"{slug}.yaml").write_text(_story(slug, EXTRA_ARTIFACT), encoding="utf-8")
    (pack / "nodes" / f"{slug}-01.yaml").write_text(_node(slug, NODE_01), encoding="utf-8")
    (pack / "nodes" / f"{slug}-02.yaml").write_text(_node(slug, NODE_02), encoding="utf-8")
    source_hash = "9df4392c5d16e92fd704737f4037be19b55e69b28635ec3d47142e5180d87ed4"
    (pack / "assets" / f"{slug}-source.yaml").write_text(
        _asset(f"cn.tang.asset.{slug}.glb", kind="model3d", fmt="glb", digest=source_hash, size=100, lod="source"),
        encoding="utf-8",
    )
    (pack / "assets" / f"{slug}-preview.yaml").write_text(
        _asset(f"cn.tang.asset.{slug}.preview", kind="preview", fmt="png", digest=PREVIEW_HASH, size=len(PREVIEW_BYTES)),
        encoding="utf-8",
    )
    (pack / "assets" / f"{slug}-display.yaml").write_text(
        _asset(f"cn.tang.asset.{slug}.display", kind="model3d", fmt="glb", digest=DISPLAY_HASH, size=len(DISPLAY_BYTES), lod="display"),
        encoding="utf-8",
    )
    gallery_path = pack / "galleries" / "main.yaml"
    gallery = yaml.safe_load(gallery_path.read_text(encoding="utf-8"))
    gallery["stations"].append(
        {
            "id": f"cn.tang.station.{slug}",
            "order": 3,
            "time_range": {"start_year": 700, "end_year": 799, "precision": "century"},
            "placement_basis": "额外联调展位。",
            "artifact_id": EXTRA_ARTIFACT,
            "side": "right",
        }
    )
    gallery_path.write_text(yaml.safe_dump(gallery, allow_unicode=True, sort_keys=False), encoding="utf-8")
    extra_preview = tmp_path / "extra-preview.png"
    extra_display = tmp_path / "extra-display.glb"
    extra_preview.write_bytes(PREVIEW_BYTES)
    extra_display.write_bytes(DISPLAY_BYTES)
    return {
        f"cn.tang.asset.{slug}.preview": extra_preview,
        f"cn.tang.asset.{slug}.display": extra_display,
    }


def test_rehearsal_pack_publishes_isolated_copy_and_keeps_author_draft(tmp_path: Path) -> None:
    pack = write_three_pack(tmp_path / "src")
    mapping = _runtime_files(tmp_path)
    sources = _sources(tmp_path, mapping)
    content_root = tmp_path / "published"
    asset_root = tmp_path / "assets"
    result = build_rehearsal_pack(
        pack_dir=pack,
        sources_path=sources,
        content_root=content_root,
        asset_root=asset_root,
        version="0.2.1",
    )
    author = yaml.safe_load((pack / "manifest.yaml").read_text(encoding="utf-8"))
    runtime = json.loads((result["pack_dir"] / "manifest.json").read_text(encoding="utf-8"))
    notice = json.loads((result["pack_dir"] / "rehearsal-notice.json").read_text(encoding="utf-8"))
    assert author["version"] == "0.1.0"
    assert author["publication_status"] == "draft"
    assert runtime["version"] == "0.2.1"
    assert runtime["publication_status"] == "published"
    assert notice["story_review_status"]["cn.tang.story.votive-stele"] == "candidate"
    assert "不冒称" in notice["note"]
    catalog = PublishedCatalog(content_root)
    loaded = catalog.get_published("cn.tang.core", "0.2.1")
    assert loaded.version == "0.2.1"
    with pytest.raises(PackNotFound):
        catalog.get_published("cn.tang.core", "0.1.0")
    index = json.loads((result["asset_dir"] / "asset-index.json").read_text(encoding="utf-8"))
    assert index["version"] == "0.2.1"
    assert "cn.tang.asset.votive-stele.preview" in index["assets"]
    assert "cn.tang.asset.votive-stele.display" in index["assets"]
    assert "cn.tang.asset.story-frame" in index["assets"]
    assert "cn.tang.asset.narration" in index["assets"]
    assert "cn.tang.asset.votive-stele.glb" not in index["assets"]

    origin = "http://localhost:5173"

    async def scenario() -> None:
        app = create_app(
            database=SQLiteDatabase(tmp_path / "http.sqlite3"),
            catalog=PublishedCatalog(content_root),
            assets=LocalAssetStore(asset_root),
            allowed_origins=frozenset({origin}),
        )
        client = TestClient(TestServer(app))
        await client.start_server()
        created = await client.post(
            "/api/sessions",
            json={"pack_id": "cn.tang.core", "version": "0.2.1"},
            headers={"Origin": origin},
        )
        assert created.status == 201
        payload = await created.json()
        session_id = payload["state"]["session_id"]
        token = payload["session_token"]
        paired = await client.post(
            f"/api/sessions/{session_id}/pair",
            headers={"Origin": origin, "Authorization": f"Bearer {token}"},
        )
        connection = (await paired.json())["connection_id"]
        bound = {
            "Origin": origin,
            "Authorization": f"Bearer {token}",
            "X-Museum-Connection": connection,
        }
        gallery = await client.get(
            f"/api/sessions/{session_id}/galleries/cn.tang.gallery.main",
            headers=bound,
        )
        assert gallery.status == 200
        body = await gallery.json()
        assert [item["artifact"]["id"] for item in body["stations"]] == list(ARTIFACTS)
        preview = await client.get(
            f"/api/sessions/{session_id}/assets/cn.tang.asset.votive-stele.preview",
            headers={"Origin": origin, "Authorization": f"Bearer {token}"},
        )
        assert preview.status == 200
        assert await preview.read() == PREVIEW_BYTES
        display = await client.get(
            f"/api/sessions/{session_id}/assets/cn.tang.asset.votive-stele.display",
            headers={"Origin": origin, "Authorization": f"Bearer {token}"},
        )
        assert display.status == 200
        assert await display.read() == DISPLAY_BYTES
        story_image = await client.get(
            f"/api/sessions/{session_id}/assets/cn.tang.asset.story-frame",
            headers={"Origin": origin, "Authorization": f"Bearer {token}"},
        )
        assert story_image.status == 200
        assert await story_image.read() == STORY_IMAGE_BYTES
        narration = await client.get(
            f"/api/sessions/{session_id}/assets/cn.tang.asset.narration",
            headers={"Origin": origin, "Authorization": f"Bearer {token}"},
        )
        assert narration.status == 200
        assert await narration.read() == STORY_AUDIO_BYTES
        draft = await client.post(
            "/api/sessions",
            json={"pack_id": "cn.tang.core", "version": "0.1.0"},
            headers={"Origin": origin},
        )
        assert draft.status == 404
        await client.close()

    asyncio.run(scenario())


def test_rehearsal_pack_rejects_missing_files_same_version_and_overwrite(tmp_path: Path) -> None:
    pack = write_three_pack(tmp_path / "src")
    mapping = _runtime_files(tmp_path)
    mapping.pop("cn.tang.asset.gilt-bronze-bull.display")
    sources = _sources(tmp_path, mapping)
    with pytest.raises(RehearsalPackError, match="缺文件"):
        build_rehearsal_pack(
            pack_dir=pack,
            sources_path=sources,
            content_root=tmp_path / "published",
            asset_root=tmp_path / "assets",
            version="0.2.1",
        )
    assert not (tmp_path / "published" / "cn.tang.core" / "0.2.1").exists()
    with pytest.raises(RehearsalPackError, match="semver"):
        build_rehearsal_pack(
            pack_dir=pack,
            sources_path=_sources(tmp_path, mapping),
            content_root=tmp_path / "published",
            asset_root=tmp_path / "assets",
            version="0.1.0",
        )
    sources = _sources(tmp_path, _runtime_files(tmp_path))
    first = build_rehearsal_pack(
        pack_dir=pack,
        sources_path=sources,
        content_root=tmp_path / "published",
        asset_root=tmp_path / "assets",
        version="0.2.1",
    )
    with pytest.raises(RehearsalPackError, match="不可覆盖"):
        build_rehearsal_pack(
            pack_dir=pack,
            sources_path=sources,
            content_root=tmp_path / "published",
            asset_root=tmp_path / "assets",
            version="0.2.1",
        )
    assert (first["pack_dir"] / "manifest.json").is_file()


def test_rehearsal_pack_can_include_explicit_additional_exhibits(tmp_path: Path) -> None:
    pack = write_three_pack(tmp_path / "src")
    mapping = _runtime_files(tmp_path)
    mapping.update(_add_extra_exhibit(pack, tmp_path))
    result = build_rehearsal_pack(
        pack_dir=pack,
        sources_path=_sources(tmp_path, mapping),
        content_root=tmp_path / "published",
        asset_root=tmp_path / "assets",
        version="0.2.2",
        artifact_ids=[*ARTIFACTS, EXTRA_ARTIFACT],
    )
    runtime = PublishedCatalog(tmp_path / "published").get_published("cn.tang.core", "0.2.2")
    assert runtime.version == "0.2.2"
    gallery = json.loads((result["pack_dir"] / "galleries" / "main.json").read_text(encoding="utf-8"))
    assert [station["artifact_id"] for station in gallery["stations"]] == [*ARTIFACTS, EXTRA_ARTIFACT]
    index = json.loads((result["asset_dir"] / "asset-index.json").read_text(encoding="utf-8"))
    assert f"cn.tang.asset.{EXTRA_ARTIFACT.split('.')[-1]}.display" in index["assets"]
    assert f"cn.tang.asset.{EXTRA_ARTIFACT.split('.')[-1]}.preview" in index["assets"]
    assert f"cn.tang.asset.{EXTRA_ARTIFACT.split('.')[-1]}.glb" not in index["assets"]


def test_rehearsal_pack_rejects_implicit_exhibits_outside_explicit_selection(tmp_path: Path) -> None:
    pack = write_three_pack(tmp_path / "src")
    mapping = _runtime_files(tmp_path)
    mapping.update(_add_extra_exhibit(pack, tmp_path))
    with pytest.raises(RehearsalPackError, match="全部展品"):
        build_rehearsal_pack(
            pack_dir=pack,
            sources_path=_sources(tmp_path, mapping),
            content_root=tmp_path / "published",
            asset_root=tmp_path / "assets",
            version="0.2.2",
            artifact_ids=list(ARTIFACTS),
        )
    assert not (tmp_path / "published" / "cn.tang.core" / "0.2.2").exists()


def test_real_tang_author_draft_stays_when_runtime_files_missing(tmp_path: Path) -> None:
    dummy = tmp_path / "missing.png"
    dummy.write_bytes(PREVIEW_BYTES)
    sources = _sources(tmp_path, {"cn.tang.asset.votive-stele.preview": dummy})
    with pytest.raises(RehearsalPackError, match="缺文件"):
        build_rehearsal_pack(
            pack_dir=PACK,
            sources_path=sources,
            content_root=tmp_path / "published",
            asset_root=tmp_path / "assets",
            version="0.2.1",
        )
    author = yaml.safe_load((PACK / "manifest.yaml").read_text(encoding="utf-8"))
    assert author["version"] == "0.2.0"
    assert author["publication_status"] == "draft"
    assert not (tmp_path / "published" / "cn.tang.core" / "0.2.1").exists()


def test_cli_rehearsal_pack_writes_version_dirs(tmp_path: Path) -> None:
    pack = write_three_pack(tmp_path / "src")
    mapping = _runtime_files(tmp_path)
    mapping.update(_add_extra_exhibit(pack, tmp_path))
    sources = _sources(tmp_path, mapping)
    artifact_args = [argument for ident in (*ARTIFACTS, EXTRA_ARTIFACT) for argument in ("--artifact-id", ident)]
    assert (
        main(
            [
                "rehearsal-pack",
                "--pack",
                str(pack),
                "--sources",
                str(sources),
                "--content-root",
                str(tmp_path / "published"),
                "--asset-root",
                str(tmp_path / "assets"),
                "--version",
                "0.2.2",
                *artifact_args,
            ]
        )
        == 0
    )
    assert (tmp_path / "published" / "cn.tang.core" / "0.2.2" / "pack-index.json").is_file()
    assert (tmp_path / "assets" / "cn.tang.core" / "0.2.2" / "asset-index.json").is_file()
    assert (
        main(
            [
                "rehearsal-pack",
                "--pack",
                str(pack),
                "--sources",
                str(sources),
                "--content-root",
                str(tmp_path / "published"),
                "--asset-root",
                str(tmp_path / "assets"),
                "--version",
                "0.2.2",
                *artifact_args,
            ]
        )
        == 1
    )
