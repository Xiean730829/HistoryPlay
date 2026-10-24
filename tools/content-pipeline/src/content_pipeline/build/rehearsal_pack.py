from __future__ import annotations

import re
import shutil
from pathlib import Path
from typing import Any

from content_pipeline.assets.stage_assets import (
    AssetStageError,
    load_source_map,
    sha256_file,
    stage_assets,
)
from content_pipeline.build.compiler import compile_pack
from content_pipeline.build.pack_writer import write_immutable_pack
from content_pipeline.validation.schema_validator import Issue

VERSION = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+$")
REQUIRED_ARTIFACTS = (
    "cn.tang.artifact.votive-stele",
    "cn.tang.artifact.kaiyuan-coin",
    "cn.tang.artifact.gilt-bronze-bull",
)


class RehearsalPackError(ValueError):
    """Raised when a local rehearsal pack cannot be produced safely."""


def build_rehearsal_pack(
    *,
    pack_dir: Path,
    sources_path: Path,
    content_root: Path,
    asset_root: Path,
    version: str,
) -> dict[str, Any]:
    if not pack_dir.is_dir():
        raise RehearsalPackError(f"内容包目录不存在：{pack_dir}")
    if not VERSION.fullmatch(version):
        raise RehearsalPackError(f"联调版本必须是semver：{version}")

    issues, documents = compile_pack(pack_dir)
    if issues or documents is None:
        raise RehearsalPackError(_format_issues(issues))

    manifest = documents.get("manifest.json")
    if not isinstance(manifest, dict):
        raise RehearsalPackError("内容包缺少清单")
    pack_id = manifest.get("id")
    author_version = manifest.get("version")
    author_status = manifest.get("publication_status")
    if not isinstance(pack_id, str) or not isinstance(author_version, str):
        raise RehearsalPackError("内容包缺少id或version")
    if version == author_version:
        raise RehearsalPackError("联调版本不能覆盖作者稿版本，须指定新的semver")

    artifacts = _documents_of(documents, "artifacts/")
    stories = _documents_of(documents, "stories/")
    assets = {item["id"]: item for item in _documents_of(documents, "assets/") if "id" in item}
    story_nodes = _documents_of(documents, "nodes/")
    required_assets = _required_runtime_assets(artifacts, stories, story_nodes, assets)
    _assert_three_exhibits(artifacts, documents)
    try:
        _assert_required_files_ready(required_assets, assets, sources_path)
    except AssetStageError as exc:
        raise RehearsalPackError(str(exc)) from exc

    pack_dest = content_root / pack_id / version
    asset_dest = asset_root / pack_id / version
    if pack_dest.exists():
        raise RehearsalPackError(f"已存在的包版本不可覆盖：{pack_id}@{version}")
    if asset_dest.exists():
        raise RehearsalPackError(f"已存在的资源版本不可覆盖：{pack_id}@{version}")

    published_manifest = dict(manifest)
    published_manifest["version"] = version
    published_manifest["publication_status"] = "published"
    published_documents = dict(documents)
    published_documents["manifest.json"] = published_manifest
    published_documents["rehearsal-notice.json"] = {
        "kind": "local-rehearsal",
        "author_pack_id": pack_id,
        "author_version": author_version,
        "author_publication_status": author_status,
        "runtime_version": version,
        "runtime_publication_status": "published",
        "required_asset_ids": sorted(required_assets),
        "story_review_status": {
            item["id"]: "candidate" for item in stories if isinstance(item.get("id"), str)
        },
        "note": (
            "runtime published 只表示该隔离包可在本机装载，"
            "不冒称全馆历史审核或用户验收通过。作者稿 draft 未被覆盖。"
        ),
    }

    write_issues, written_pack = write_immutable_pack(content_root, published_documents)
    if write_issues or written_pack is None:
        raise RehearsalPackError(_format_issues(write_issues))
    try:
        written_assets = stage_assets(
            pack_dir=pack_dir,
            sources_path=sources_path,
            out_root=asset_root,
            require_all=True,
            runtime_version=version,
            include_ids=required_assets,
        )
    except (AssetStageError, Exception) as exc:
        shutil.rmtree(written_pack, ignore_errors=True)
        if isinstance(exc, AssetStageError):
            raise RehearsalPackError(str(exc)) from exc
        raise

    author_manifest = pack_dir / "manifest.yaml"
    return {
        "pack_id": pack_id,
        "author_version": author_version,
        "author_publication_status": author_status,
        "runtime_version": version,
        "pack_dir": written_pack,
        "asset_dir": written_assets,
        "required_asset_ids": sorted(required_assets),
        "author_manifest": author_manifest,
    }


def _documents_of(documents: dict[str, object], prefix: str) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    for name, data in documents.items():
        if name.startswith(prefix) and isinstance(data, dict):
            found.append(data)
    return found


def _assert_three_exhibits(
    artifacts: list[dict[str, Any]], documents: dict[str, object]
) -> None:
    found = {item.get("id") for item in artifacts}
    missing = [ident for ident in REQUIRED_ARTIFACTS if ident not in found]
    if missing:
        raise RehearsalPackError(f"联调包缺少三件文物：{missing[0]}")
    galleries = _documents_of(documents, "galleries/")
    if not galleries:
        raise RehearsalPackError("联调包缺少展厅")
    stations = galleries[0].get("stations")
    if not isinstance(stations, list):
        raise RehearsalPackError("展厅缺少展位")
    station_artifacts = [
        station.get("artifact_id") for station in stations if isinstance(station, dict)
    ]
    for ident in REQUIRED_ARTIFACTS:
        if ident not in station_artifacts:
            raise RehearsalPackError(f"展厅未编排三件文物：{ident}")


def _required_runtime_assets(
    artifacts: list[dict[str, Any]],
    stories: list[dict[str, Any]],
    story_nodes: list[dict[str, Any]],
    assets: dict[str, dict[str, Any]],
) -> frozenset[str]:
    required: set[str] = set()
    by_id = {item.get("id"): item for item in artifacts}
    for ident in REQUIRED_ARTIFACTS:
        artifact = by_id[ident]
        presentation = artifact.get("presentation")
        if not isinstance(presentation, dict):
            raise RehearsalPackError(f"文物缺少展示绑定：{ident}")
        preview_id = presentation.get("preview_asset_id")
        display = presentation.get("display")
        if not isinstance(preview_id, str) or not isinstance(display, dict):
            raise RehearsalPackError(f"文物缺少预览或展示资产：{ident}")
        display_id = display.get("asset_id")
        if display.get("kind") != "model3d" or not isinstance(display_id, str):
            raise RehearsalPackError(f"文物展示资产必须是model3d：{ident}")
        background = presentation.get("background_node_id")
        story_entry_ids = artifact.get("story_entry_ids")
        if not isinstance(background, str) or not story_entry_ids:
            raise RehearsalPackError(f"文物缺少创作讲稿引用：{ident}")
        for asset_id, label in ((preview_id, "预览"), (display_id, "展示版")):
            meta = assets.get(asset_id)
            if meta is None:
                raise RehearsalPackError(f"缺少{label}资产：{asset_id}")
            if meta.get("lod") == "source":
                raise RehearsalPackError(f"不能把源模型作为联调{label}资产：{asset_id}")
            required.add(asset_id)
    story_ids = {item.get("id") for item in stories}
    for node in story_nodes:
        if node.get("story_id") not in story_ids:
            continue
        presentation = node.get("presentation")
        if not isinstance(presentation, dict):
            continue
        references = presentation.get("asset_ids", [])
        if not isinstance(references, list):
            raise RehearsalPackError("故事节点presentation.asset_ids必须是数组")
        audio_id = presentation.get("audio_asset_id")
        if audio_id is not None:
            references = [*references, audio_id]
        for asset_id in references:
            if not isinstance(asset_id, str):
                raise RehearsalPackError("故事节点资源ID必须是字符串")
            meta = assets.get(asset_id)
            if meta is None:
                raise RehearsalPackError(f"缺少故事资源资产：{asset_id}")
            if meta.get("lod") == "source":
                raise RehearsalPackError(f"不能把源模型作为故事资源：{asset_id}")
            required.add(asset_id)
    return frozenset(required)


def _assert_required_files_ready(
    required_ids: frozenset[str],
    assets: dict[str, dict[str, Any]],
    sources_path: Path,
) -> None:
    sources = load_source_map(sources_path)
    for asset_id in sorted(required_ids):
        source = sources.get(asset_id)
        if source is None or not source.is_file():
            raise RehearsalPackError(f"发布清单缺文件：{asset_id}")
        meta = assets[asset_id]
        expected_hash = meta.get("sha256")
        expected_size = meta.get("byte_size")
        if not isinstance(expected_hash, str):
            raise RehearsalPackError(f"资产缺少哈希：{asset_id}")
        actual_size = source.stat().st_size
        if isinstance(expected_size, int) and actual_size != expected_size:
            raise RehearsalPackError(f"文件大小与清单不一致：{asset_id}")
        if sha256_file(source) != expected_hash:
            raise RehearsalPackError(f"文件哈希与清单不一致：{asset_id}")


def _format_issues(issues: list[Issue]) -> str:
    if not issues:
        return "内容包校验失败"
    first = issues[0]
    return f"{first.path.name}: {first.message}"
