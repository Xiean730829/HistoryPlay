from __future__ import annotations

import asyncio
import hashlib
import json
from pathlib import Path

import pytest
import yaml
from aiohttp.test_utils import TestClient, TestServer
from content_pipeline.build.rehearsal_pack import (
    RehearsalPackError,
    build_rehearsal_pack,
)
from content_pipeline.cli import main
from museum.adapters.assets.local_store import LocalAssetStore
from museum.adapters.content.published_catalog import PublishedCatalog
from museum.adapters.sqlite.database import SQLiteDatabase
from museum.main import create_app
from test_reference_validator import write_pack


def make_source_map(pack: Path, tmp_path: Path, *, include_asset: bool = True) -> Path:
    asset_path = pack / "assets" / "stele.yaml"
    asset = yaml.safe_load(asset_path.read_text(encoding="utf-8"))
    source = tmp_path / "stele.glb"
    source.write_bytes(b"test-glb-content")
    asset["sha256"] = hashlib.sha256(source.read_bytes()).hexdigest()
    asset["byte_size"] = source.stat().st_size
    asset_path.write_text(yaml.safe_dump(asset, sort_keys=False), encoding="utf-8")
    mapping = {
        "schema_version": 1,
        "sources": {asset["id"]: str(source)} if include_asset else {},
    }
    sources_path = tmp_path / "asset-sources.json"
    sources_path.write_text(json.dumps(mapping), encoding="utf-8")
    return sources_path


def test_build_rehearsal_isolated_immutable_pack_and_keeps_candidate_status(
    tmp_path: Path,
) -> None:
    pack = write_pack(tmp_path)
    sources = make_source_map(pack, tmp_path)
    gallery = {
        "id": "cn.tang.gallery.main",
        "title": "唐朝长廊",
        "region": {"id": "cn", "label": "中国"},
        "status": "open",
        "default_station_id": "cn.tang.station.stele",
        "stations": [
            {
                "id": "cn.tang.station.stele",
                "order": 0,
                "time_range": {"start_year": 678, "end_year": 678, "precision": "year"},
                "placement_basis": "明确纪年展品作为入口。",
                "artifact_id": "cn.tang.artifact.stele",
            }
        ],
    }
    (pack / "galleries" / "main.yaml").write_text(
        yaml.safe_dump(gallery, allow_unicode=True), encoding="utf-8"
    )
    out = tmp_path / ".local" / "rehearsal"

    result = build_rehearsal_pack(
        pack_dir=pack, sources_path=sources, out_dir=out, version="0.1.1"
    )

    assert result == out
    original_manifest = yaml.safe_load((pack / "manifest.yaml").read_text(encoding="utf-8"))
    assert original_manifest["publication_status"] == "draft"
    assert original_manifest["version"] == "0.1.0"
    catalog = PublishedCatalog(out / "content")
    runtime_pack = catalog.get_published("cn.tang.core", "0.1.1")
    manifest = runtime_pack.documents["manifest.json"]
    assert isinstance(manifest, dict)
    assert manifest["publication_status"] == "published"
    assert runtime_pack.documents["stories/observation.json"]["title"] == "造像碑三片段观察"
    rehearsal = json.loads((out / "rehearsal-manifest.json").read_text(encoding="utf-8"))
    assert rehearsal["scope"] == "local_rehearsal"
    assert rehearsal["source"]["publication_status"] == "draft"
    assert rehearsal["runtime"]["publication_status"] == "published"
    assert rehearsal["story_review"] == [
        {
            "story_id": "cn.tang.story.stele-observation",
            "title": "造像碑三片段观察",
            "review_status": "candidate_unreviewed",
        }
    ]

    async def smoke_runtime() -> None:
        client = TestClient(
            TestServer(
                create_app(
                    database=SQLiteDatabase(tmp_path / "rehearsal.sqlite3"),
                    catalog=catalog,
                    assets=LocalAssetStore(out / "assets"),
                    allowed_origins=frozenset({"http://localhost:5173"}),
                )
            )
        )
        await client.start_server()
        origin = {"Origin": "http://localhost:5173"}
        created_response = await client.post(
            "/api/sessions", json={"pack_id": "cn.tang.core", "version": "0.1.1"}, headers=origin
        )
        assert created_response.status == 201
        created = await created_response.json()
        session_id = created["state"]["session_id"]
        auth = {**origin, "Authorization": f"Bearer {created['session_token']}"}
        paired_response = await client.post(f"/api/sessions/{session_id}/pair", headers=auth)
        assert paired_response.status == 201
        paired = await paired_response.json()
        bound = {**auth, "X-Museum-Connection": paired["connection_id"]}
        gallery_response = await client.get(
            f"/api/sessions/{session_id}/galleries/cn.tang.gallery.main", headers=bound
        )
        assert gallery_response.status == 200
        gallery_data = await gallery_response.json()
        assert gallery_data["stations"][0]["artifact"]["id"] == "cn.tang.artifact.stele"
        asset_response = await client.get(
            f"/api/sessions/{session_id}/assets/cn.tang.asset.stele.original", headers=auth
        )
        assert asset_response.status == 200
        assert await asset_response.read() == b"test-glb-content"
        await client.close()

    asyncio.run(smoke_runtime())

    with pytest.raises(RehearsalPackError, match="不可覆盖"):
        build_rehearsal_pack(
            pack_dir=pack, sources_path=sources, out_dir=out, version="0.1.1"
        )


def test_build_rehearsal_requires_all_assets_before_publishing_output(tmp_path: Path) -> None:
    pack = write_pack(tmp_path)
    sources = make_source_map(pack, tmp_path, include_asset=False)
    out = tmp_path / ".local" / "rehearsal"

    with pytest.raises(RehearsalPackError, match="资源校验失败"):
        build_rehearsal_pack(
            pack_dir=pack, sources_path=sources, out_dir=out, version="0.1.1"
        )

    assert not out.exists()


def test_build_rehearsal_rejects_version_reuse_and_non_draft_sources(tmp_path: Path) -> None:
    pack = write_pack(tmp_path)
    sources = make_source_map(pack, tmp_path)
    with pytest.raises(RehearsalPackError, match="不同于作者稿"):
        build_rehearsal_pack(
            pack_dir=pack, sources_path=sources, out_dir=tmp_path / "same", version="0.1.0"
        )
    with pytest.raises(RehearsalPackError, match="不能覆盖或包含"):
        build_rehearsal_pack(
            pack_dir=pack, sources_path=sources, out_dir=pack / "rehearsal", version="0.1.1"
        )

    manifest_path = pack / "manifest.yaml"
    manifest = yaml.safe_load(manifest_path.read_text(encoding="utf-8"))
    manifest["publication_status"] = "published"
    manifest_path.write_text(yaml.safe_dump(manifest, sort_keys=False), encoding="utf-8")
    with pytest.raises(RehearsalPackError, match="只接受draft"):
        build_rehearsal_pack(
            pack_dir=pack,
            sources_path=sources,
            out_dir=tmp_path / "published",
            version="0.1.2",
        )


def test_cli_build_rehearsal_creates_requested_output(tmp_path: Path) -> None:
    pack = write_pack(tmp_path)
    sources = make_source_map(pack, tmp_path)
    out = tmp_path / "rehearsal"

    assert main(
        [
            "build-rehearsal",
            "--pack",
            str(pack),
            "--sources",
            str(sources),
            "--out",
            str(out),
            "--version",
            "0.1.1",
        ]
    ) == 0
    assert (out / "rehearsal-manifest.json").is_file()
