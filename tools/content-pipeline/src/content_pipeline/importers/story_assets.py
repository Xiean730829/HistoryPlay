from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
from pathlib import Path, PureWindowsPath
from typing import Any

from yaml import YAMLError

from content_pipeline.validation.schema_validator import iter_pack_files, load_yaml


class StoryAssetImportError(ValueError):
    """The selected local story media cannot be safely imported as a candidate."""


def build_story_asset_candidate(
    *,
    source_root: Path,
    pack_dir: Path,
    binding_key: str,
    story_id: str,
    node_ids: list[str],
) -> dict[str, Any]:
    """Resolve one selected image and preserve its review state in an unpublished manifest."""
    try:
        root = source_root.resolve(strict=True)
    except (OSError, RuntimeError) as error:
        raise StoryAssetImportError("本机素材来源目录不可读") from error
    manifest = _read_json(root / "manifest.local.json")
    replacements = _read_json(root / "replacement-assets.json").get("replacements")
    bindings = _read_json(root / "content" / "scene-bindings.json")
    if not isinstance(replacements, dict):
        raise StoryAssetImportError("替换素材清单格式无效")
    if (
        not isinstance(node_ids, list)
        or not node_ids
        or any(not _stable_id(item) for item in node_ids)
    ):
        raise StoryAssetImportError("必须提供至少一个有效故事节点ID")
    if len(set(node_ids)) != len(node_ids):
        raise StoryAssetImportError("故事节点ID不能重复")
    if not _stable_id(story_id):
        raise StoryAssetImportError("故事ID无效")
    _validate_story_nodes(pack_dir, story_id, node_ids)

    scene_assets = bindings.get("artifact_story_assets")
    if not isinstance(scene_assets, dict):
        raise StoryAssetImportError("故事场景绑定清单格式无效")
    selected = scene_assets.get(binding_key)
    if not _stable_id(selected):
        raise StoryAssetImportError(f"场景绑定中不存在选择项：{binding_key}")
    assets = manifest.get("assets")
    if not isinstance(assets, list):
        raise StoryAssetImportError("本机素材清单格式无效")
    matches = [
        item
        for item in assets
        if isinstance(item, dict) and item.get("asset_id") == selected
    ]
    if len(matches) != 1:
        raise StoryAssetImportError("所选素材ID必须在本机清单中唯一")
    asset = matches[0]
    if not _stable_id(asset.get("asset_id")):
        raise StoryAssetImportError("所选素材ID格式无效")

    name = asset.get("name")
    if isinstance(name, str) and name in replacements:
        raise StoryAssetImportError(f"所选素材已被替换，不能导入原稿：{name}")
    title = asset.get("title")
    if "reference" in selected.lower() or (
        isinstance(title, str) and ("角色设定" in title or "人物设定" in title)
    ):
        raise StoryAssetImportError("人物设定参考图不能直接作为故事场景素材")
    relative_path = asset.get("relative_path")
    if not isinstance(relative_path, str) or not relative_path:
        raise StoryAssetImportError("所选素材缺少相对路径")
    source_path = _resolve_source_file(root, relative_path)
    declared_path = asset.get("path")
    if declared_path:
        if not isinstance(declared_path, str):
            raise StoryAssetImportError("素材本机路径必须是字符串")
        try:
            resolved_declared_path = Path(declared_path).resolve(strict=True)
        except (OSError, RuntimeError, ValueError) as error:
            raise StoryAssetImportError("本机素材路径不可读") from error
        if resolved_declared_path != source_path:
            raise StoryAssetImportError("素材路径与相对路径指向不同文件")
    payload = source_path.read_bytes()
    image_format = source_path.suffix.lower().lstrip(".")
    if image_format == "jpeg":
        image_format = "jpg"
    _validate_image_payload(payload, image_format)
    digest = hashlib.sha256(payload).hexdigest()
    declared_digest = asset.get("sha256")
    if not isinstance(declared_digest, str) or not re.fullmatch(
        r"[0-9a-fA-F]{64}", declared_digest
    ):
        raise StoryAssetImportError("所选素材缺少有效SHA-256")
    if digest != declared_digest.lower():
        raise StoryAssetImportError("所选素材SHA-256与清单不符")
    visual_review = asset.get("visual_review")
    if not isinstance(visual_review, dict):
        visual_review = {}
    review_status = (
        asset.get("review_status")
        or asset.get("publication_status")
        or "candidate_review_pending"
    )
    return {
        "schema_version": 1,
        "status": "candidate_not_published",
        "source_manifest_version": manifest.get("version"),
        "source_created_on": manifest.get("created_on"),
        "story_id": story_id,
        "source_key": binding_key,
        "node_bindings": [{"node_id": node_id, "asset_id": selected} for node_id in node_ids],
        "assets": [
            {
                "id": selected,
                "title": title if isinstance(title, str) else "",
                "kind": "image",
                "format": image_format,
                "relative_path": relative_path.replace("\\", "/"),
                "sha256": digest,
                "byte_size": len(payload),
                "review": {
                    "source_status": asset.get("status"),
                    "review_status": review_status,
                    "historical_review": visual_review.get("historical_review"),
                    "art_direction_review": visual_review.get("user_art_direction_review"),
                    "publication_status": asset.get("publication_status", "candidate_not_published"),
                },
            }
        ],
        "notice": "候选素材清单；未通过审核或发布，不会进入运行时内容包。",
    }


def import_story_asset_candidate(
    *,
    source_root: Path,
    pack_dir: Path,
    output_file: Path,
    binding_key: str,
    story_id: str,
    node_ids: list[str],
) -> dict[str, Any]:
    """Write a candidate binding atomically and refuse to overwrite prior review evidence."""
    candidate = build_story_asset_candidate(
        source_root=source_root,
        pack_dir=pack_dir,
        binding_key=binding_key,
        story_id=story_id,
        node_ids=node_ids,
    )
    output = output_file.resolve()
    if output.exists():
        raise StoryAssetImportError(f"候选清单已存在，请先人工审核：{output.name}")
    output.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary_name = tempfile.mkstemp(prefix=f".{output.name}.", dir=output.parent)
    try:
        with os.fdopen(handle, "w", encoding="utf-8", newline="\n") as stream:
            json.dump(candidate, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
        os.replace(temporary_name, output)
    except Exception:
        Path(temporary_name).unlink(missing_ok=True)
        raise
    return candidate


def _read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise StoryAssetImportError(f"无法读取本机导入清单：{path.name}") from error
    if not isinstance(value, dict):
        raise StoryAssetImportError(f"本机导入清单必须是对象：{path.name}")
    return value


def _resolve_source_file(root: Path, relative_path: str) -> Path:
    candidate = Path(relative_path)
    windows_candidate = PureWindowsPath(relative_path)
    if (
        candidate.is_absolute()
        or candidate.drive
        or windows_candidate.is_absolute()
        or windows_candidate.drive
        or ".." in candidate.parts
        or ".." in windows_candidate.parts
    ):
        raise StoryAssetImportError("素材相对路径不得离开本机来源目录")
    try:
        resolved = (root / candidate).resolve(strict=True)
        resolved.relative_to(root)
    except (OSError, ValueError) as error:
        raise StoryAssetImportError("素材文件不存在或路径越界") from error
    if not resolved.is_file():
        raise StoryAssetImportError("所选素材不是普通文件")
    return resolved


def _stable_id(value: object) -> bool:
    return isinstance(value, str) and bool(re.fullmatch(r"[a-z][a-z0-9.-]{2,127}", value))


def _validate_story_nodes(pack_dir: Path, story_id: str, node_ids: list[str]) -> None:
    if not pack_dir.is_dir():
        raise StoryAssetImportError("作者内容包目录不存在")
    stories: dict[str, dict[str, Any]] = {}
    nodes: dict[str, dict[str, Any]] = {}
    try:
        documents = iter_pack_files(pack_dir)
        for path, kind in documents:
            if kind not in {"story", "story-node"}:
                continue
            document = load_yaml(path)
            if not isinstance(document, dict):
                raise StoryAssetImportError(f"作者稿必须是YAML对象：{path.name}")
            identifier = document.get("id")
            if not isinstance(identifier, str):
                continue
            destination = stories if kind == "story" else nodes
            if identifier in destination:
                raise StoryAssetImportError(f"作者稿ID重复：{identifier}")
            destination[identifier] = document
    except (OSError, UnicodeError, YAMLError) as error:
        raise StoryAssetImportError("无法读取作者故事与节点稿") from error

    story = stories.get(story_id)
    if story is None:
        raise StoryAssetImportError(f"作者内容包中不存在故事：{story_id}")
    declared_nodes = story.get("node_ids")
    if not isinstance(declared_nodes, list) or any(
        not isinstance(item, str) for item in declared_nodes
    ):
        raise StoryAssetImportError(f"故事节点清单格式无效：{story_id}")
    if any(node_id not in declared_nodes for node_id in node_ids):
        raise StoryAssetImportError("候选节点未被目标故事引用")
    for node_id in node_ids:
        node = nodes.get(node_id)
        if node is None or node.get("story_id") != story_id:
            raise StoryAssetImportError(f"节点与目标故事引用不一致：{node_id}")


def _validate_image_payload(payload: bytes, image_format: str) -> None:
    signatures = {
        "jpg": payload.startswith(b"\xff\xd8\xff"),
        "png": payload.startswith(b"\x89PNG\r\n\x1a\n"),
        "webp": (
            len(payload) >= 12
            and payload[:4] == b"RIFF"
            and payload[8:12] == b"WEBP"
        ),
    }
    if image_format not in signatures:
        raise StoryAssetImportError("故事场景只接受JPG、PNG或WebP图片")
    if not signatures[image_format]:
        raise StoryAssetImportError("素材扩展名与图片文件格式不符或图片不可读")
