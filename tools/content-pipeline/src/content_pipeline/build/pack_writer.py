from __future__ import annotations

import hashlib
import json
import uuid
from pathlib import Path
from typing import Any

from content_pipeline.validation.dependencies import dependency_hash
from content_pipeline.validation.schema_validator import Issue, load_yaml

INDEX_NAME = "pack-index.json"


def canonical_bytes(data: object) -> bytes:
    return json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode(
        "utf-8"
    )


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def pack_destination(root: Path, documents: dict[str, object]) -> tuple[Issue | None, Path | None]:
    manifest = documents.get("manifest.json")
    if not isinstance(manifest, dict):
        return Issue(root, "缺少编译后的内容包清单"), None
    pack_id = manifest.get("id")
    version = manifest.get("version")
    if not isinstance(pack_id, str) or not pack_id:
        return Issue(root, "内容包缺少标识"), None
    if not isinstance(version, str) or not version:
        return Issue(root, "内容包缺少版本"), None
    return None, root / pack_id / version


def build_index(
    documents: dict[str, object],
    file_hashes: dict[str, str],
    dependencies: list[dict[str, str]] | None = None,
) -> dict[str, object]:
    manifest = documents["manifest.json"]
    assert isinstance(manifest, dict)
    return {
        "id": manifest["id"],
        "version": manifest["version"],
        "schema_version": manifest.get("schema_version", "1"),
        "publication_status": manifest.get("publication_status"),
        "files": file_hashes,
        "dependencies": dependencies or [],
    }


def write_immutable_pack(
    root: Path, documents: dict[str, object], dependency_packs: list[Path] | None = None
) -> tuple[list[Issue], Path | None]:
    issue, dest = pack_destination(root, documents)
    if issue is not None or dest is None:
        return [issue] if issue else [Issue(root, "无法确定发布目录")], None
    manifest = documents.get("manifest.json")
    if not isinstance(manifest, dict):
        return [Issue(root, "缺少编译后的内容包清单")], None
    if dest.exists():
        return [Issue(dest, "已存在的包版本不可覆盖")], None

    declared = manifest.get("dependencies", [])
    candidates: dict[tuple[str, str], list[Path]] = {}
    for pack in dependency_packs or []:
        dep_manifest = load_yaml(pack / "manifest.yaml")
        if isinstance(dep_manifest, dict):
            dep_id, dep_version = dep_manifest.get("id"), dep_manifest.get("version")
            if isinstance(dep_id, str) and isinstance(dep_version, str):
                candidates.setdefault((dep_id, dep_version), []).append(pack)
    dependency_entries: list[dict[str, str]] = []
    issues: list[Issue] = []
    for item in declared if isinstance(declared, list) else []:
        if not isinstance(item, dict):
            continue
        dep_id, dep_version = item.get("pack_id"), item.get("version")
        if not isinstance(dep_id, str) or not isinstance(dep_version, str):
            continue
        matches = candidates.get((dep_id, dep_version), [])
        if len(matches) != 1:
            issues.append(Issue(dest, f"无法固定依赖包的唯一版本：{dep_id}@{dep_version}"))
            continue
        dependency_entries.append(
            {"pack_id": dep_id, "version": dep_version, "sha256": dependency_hash(matches[0])}
        )
    if issues:
        return issues, None
    dependency_entries.sort(key=lambda item: (item["pack_id"], item["version"]))

    hashes: dict[str, str] = {}
    payloads: dict[str, bytes] = {}
    for relative, data in documents.items():
        encoded = canonical_bytes(data)
        hashes[relative] = sha256_hex(encoded)
        payloads[relative] = encoded
    index = build_index(documents, hashes, dependency_entries)
    payloads[INDEX_NAME] = canonical_bytes(index)

    tmp = dest.with_name(f".{dest.name}.{uuid.uuid4().hex}.tmp")
    try:
        tmp.mkdir(parents=True, exist_ok=False)
        for relative, encoded in payloads.items():
            target = (tmp / relative).resolve()
            if not target.is_relative_to(tmp.resolve()):
                return [Issue(dest, f"编译输出路径越界：{relative}")], None
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(encoded)
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp.replace(dest)
    except Exception:
        if tmp.exists():
            _remove_tree(tmp)
        raise
    return [], dest


def read_index(pack_dir: Path) -> dict[str, Any]:
    return json.loads((pack_dir / INDEX_NAME).read_text(encoding="utf-8"))


def _remove_tree(path: Path) -> None:
    for child in sorted(path.rglob("*"), reverse=True):
        if child.is_file():
            child.unlink()
        elif child.is_dir():
            child.rmdir()
    path.rmdir()
