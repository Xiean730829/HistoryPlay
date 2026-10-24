from __future__ import annotations

import json
import re
import shutil
import tempfile
from pathlib import Path
from typing import Any

import yaml

from content_pipeline.assets.stage_assets import AssetStageError, stage_assets
from content_pipeline.build.compiler import compile_pack
from content_pipeline.build.pack_writer import write_immutable_pack
from content_pipeline.validation.schema_validator import iter_pack_files, load_yaml

SEMVER = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")


class RehearsalPackError(ValueError):
    """Raised when a local rehearsal package cannot be built safely."""


def build_rehearsal_pack(
    *, pack_dir: Path, sources_path: Path, out_dir: Path, version: str
) -> Path:
    if not pack_dir.is_dir():
        raise RehearsalPackError(f"内容包目录不存在：{pack_dir}")
    if not SEMVER.fullmatch(version):
        raise RehearsalPackError("联调版本必须是 major.minor.patch 格式")
    source_pack = pack_dir.resolve()
    destination = out_dir.resolve()
    source_map = sources_path.resolve()
    if destination.exists():
        raise RehearsalPackError(f"联调版本目录不可覆盖：{destination}")
    if _overlaps(destination, source_pack) or _overlaps(destination, source_map):
        raise RehearsalPackError("联调输出目录不能覆盖或包含作者包/资源来源配置")

    manifest_path = pack_dir / "manifest.yaml"
    try:
        manifest = load_yaml(manifest_path)
    except (OSError, yaml.YAMLError) as exc:
        raise RehearsalPackError(f"无法读取作者稿清单：{exc}") from exc
    if not isinstance(manifest, dict):
        raise RehearsalPackError("作者稿清单无效")
    source_status = manifest.get("publication_status")
    if source_status != "draft":
        raise RehearsalPackError("本机联调只接受draft作者包，不得重打正式发布包")
    source_version = manifest.get("version")
    pack_id = manifest.get("id")
    if not isinstance(source_version, str) or not isinstance(pack_id, str):
        raise RehearsalPackError("作者稿清单缺少包ID或版本")
    if version == source_version:
        raise RehearsalPackError("联调包必须使用不同于作者稿的新版本号")

    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(
        prefix=f".{destination.name}.", suffix=".tmp", dir=destination.parent
    ) as temporary:
        staging = Path(temporary)
        staged_authoring = staging / "authoring"
        shutil.copytree(source_pack, staged_authoring)
        runtime_manifest = dict(manifest)
        runtime_manifest["version"] = version
        # The runtime catalog uses this status only to load the isolated local copy.
        runtime_manifest["publication_status"] = "published"
        (staged_authoring / "manifest.yaml").write_text(
            yaml.safe_dump(runtime_manifest, sort_keys=False, allow_unicode=True),
            encoding="utf-8",
        )

        issues, documents = compile_pack(staged_authoring)
        if issues or documents is None:
            raise RehearsalPackError(
                "作者稿校验或编译失败：" + "; ".join(str(issue) for issue in issues)
            )
        pack_issues, pack_path = write_immutable_pack(staging / "content", documents)
        if pack_issues or pack_path is None:
            raise RehearsalPackError(
                "联调内容包写入失败：" + "; ".join(str(issue) for issue in pack_issues)
            )
        try:
            stage_assets(
                pack_dir=staged_authoring,
                sources_path=sources_path,
                out_root=staging / "assets",
                require_all=True,
            )
        except AssetStageError as exc:
            raise RehearsalPackError(f"联调资源校验失败：{exc}") from exc

        rehearsal_manifest = {
            "schema_version": 1,
            "scope": "local_rehearsal",
            "source": {
                "pack_id": pack_id,
                "version": source_version,
                "publication_status": source_status,
            },
            "runtime": {
                "pack_id": pack_id,
                "version": version,
                "publication_status": "published",
                "meaning": "仅供本机PublishedCatalog装载，不代表历史审核或用户验收通过",
            },
            "story_review": _candidate_stories(staged_authoring),
            "content_root": "content",
            "asset_root": "assets",
        }
        (staging / "rehearsal-manifest.json").write_text(
            json.dumps(rehearsal_manifest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        shutil.rmtree(staged_authoring)
        staging.replace(destination)
    return destination


def _candidate_stories(pack_dir: Path) -> list[dict[str, Any]]:
    stories: list[dict[str, Any]] = []
    for path, kind in iter_pack_files(pack_dir):
        if kind != "story":
            continue
        story = load_yaml(path)
        if isinstance(story, dict) and isinstance(story.get("id"), str):
            stories.append(
                {
                    "story_id": story["id"],
                    "title": story.get("title"),
                    "review_status": "candidate_unreviewed",
                }
            )
    return sorted(stories, key=lambda item: item["story_id"])


def _overlaps(left: Path, right: Path) -> bool:
    return left == right or left.is_relative_to(right) or right.is_relative_to(left)
