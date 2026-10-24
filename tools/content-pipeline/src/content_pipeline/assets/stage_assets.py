from __future__ import annotations

import hashlib
import json
import re
import shutil
import uuid
from pathlib import Path
from typing import Any

from content_pipeline.validation.schema_validator import iter_pack_files, load_yaml

ASSET_ID = re.compile(r"^[a-z]{2}(?:\.[a-z0-9-]+){2,8}$")
INDEX_NAME = "asset-index.json"
FILES_DIR = "files"


class AssetStageError(ValueError):
    """Raised when local display assets cannot be staged safely."""


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_source_map(path: Path) -> dict[str, Path]:
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise AssetStageError(f"无法读取本机资源来源配置：{exc}") from exc
    if not isinstance(document, dict) or document.get("schema_version") != 1:
        raise AssetStageError("本机资源来源配置必须是schema_version为1的JSON对象")
    sources = document.get("sources")
    if not isinstance(sources, dict) or not sources:
        raise AssetStageError("本机资源来源配置必须提供非空sources对象")
    mapping: dict[str, Path] = {}
    for asset_id, raw_path in sources.items():
        if not isinstance(asset_id, str) or not ASSET_ID.fullmatch(asset_id):
            raise AssetStageError(f"来源配置包含非法asset_id：{asset_id}")
        if not isinstance(raw_path, str) or not raw_path.strip():
            raise AssetStageError(f"来源路径必须是字符串：{asset_id}")
        local_path = Path(raw_path)
        if not local_path.is_absolute():
            local_path = (path.parent / local_path).resolve()
        else:
            local_path = local_path.resolve()
        mapping[asset_id] = local_path
    return mapping


def _pack_assets(pack_dir: Path) -> dict[str, dict[str, Any]]:
    assets: dict[str, dict[str, Any]] = {}
    for file_path, kind in iter_pack_files(pack_dir):
        if kind != "asset":
            continue
        data = load_yaml(file_path)
        if not isinstance(data, dict) or not isinstance(data.get("id"), str):
            raise AssetStageError(f"资产源稿无效：{file_path.name}")
        assets[data["id"]] = data
    if not assets:
        raise AssetStageError("内容包没有可登记的资产")
    return assets


def _pack_identity(pack_dir: Path) -> tuple[str, str]:
    manifest = load_yaml(pack_dir / "manifest.yaml")
    if not isinstance(manifest, dict):
        raise AssetStageError("内容包缺少清单")
    pack_id = manifest.get("id")
    version = manifest.get("version")
    if not isinstance(pack_id, str) or not isinstance(version, str):
        raise AssetStageError("内容包缺少id或version")
    return pack_id, version


def stage_assets(
    *,
    pack_dir: Path,
    sources_path: Path,
    out_root: Path,
    require_all: bool = False,
) -> Path:
    if not pack_dir.is_dir():
        raise AssetStageError(f"内容包目录不存在：{pack_dir}")
    pack_id, version = _pack_identity(pack_dir)
    authored = _pack_assets(pack_dir)
    sources = load_source_map(sources_path)
    unknown = sorted(asset_id for asset_id in sources if asset_id not in authored)
    if unknown:
        raise AssetStageError(f"来源配置包含内容包没有的资产：{unknown[0]}")
    missing = sorted(asset_id for asset_id in authored if asset_id not in sources)
    if require_all and missing:
        raise AssetStageError(f"发布清单缺文件：{missing[0]}")

    dest = (out_root / pack_id / version).resolve()
    root = out_root.resolve()
    if not dest.is_relative_to(root):
        raise AssetStageError("资源输出路径越界")
    if dest.exists():
        raise AssetStageError(f"已存在的资源版本不可覆盖：{pack_id}@{version}")

    selected = [asset_id for asset_id in sorted(authored) if asset_id in sources]
    if not selected:
        raise AssetStageError("没有可复制的展示资产")

    records: dict[str, dict[str, Any]] = {}
    payloads: dict[str, Path] = {}
    for asset_id in selected:
        meta = authored[asset_id]
        source = sources[asset_id]
        if not source.is_file():
            raise AssetStageError(f"找不到本机源文件：{asset_id}")
        expected_hash = meta.get("sha256")
        expected_size = meta.get("byte_size")
        fmt = meta.get("format")
        if not isinstance(expected_hash, str) or not isinstance(fmt, str):
            raise AssetStageError(f"资产缺少哈希或格式：{asset_id}")
        actual_size = source.stat().st_size
        if isinstance(expected_size, int) and actual_size != expected_size:
            raise AssetStageError(f"文件大小与清单不一致：{asset_id}")
        digest = sha256_file(source)
        if digest != expected_hash:
            raise AssetStageError(f"文件哈希与清单不一致：{asset_id}")
        relative = f"{FILES_DIR}/{digest}.{fmt}"
        records[asset_id] = {
            "sha256": digest,
            "format": fmt,
            "byte_size": actual_size,
            "kind": meta.get("kind"),
            "path": relative,
        }
        payloads[relative] = source

    index = {
        "schema_version": 1,
        "pack_id": pack_id,
        "version": version,
        "assets": records,
    }
    tmp = dest.with_name(f".{dest.name}.{uuid.uuid4().hex}.tmp")
    try:
        tmp.mkdir(parents=True, exist_ok=False)
        for relative, source in payloads.items():
            target = (tmp / relative).resolve()
            if not target.is_relative_to(tmp.resolve()):
                raise AssetStageError(f"资源输出路径越界：{relative}")
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
            copied_id = next(key for key, value in records.items() if value["path"] == relative)
            if sha256_file(target) != records[copied_id]["sha256"]:
                raise AssetStageError(f"复制后哈希校验失败：{copied_id}")
        (tmp / INDEX_NAME).write_text(
            json.dumps(index, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp.replace(dest)
    except Exception:
        if tmp.exists():
            _remove_tree(tmp)
        raise
    return dest


def _remove_tree(path: Path) -> None:
    for child in sorted(path.rglob("*"), reverse=True):
        if child.is_file():
            child.unlink()
        elif child.is_dir():
            child.rmdir()
    path.rmdir()
