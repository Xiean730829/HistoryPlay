from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Mapping
from pathlib import Path
from types import MappingProxyType
from typing import Any

from museum.ports.asset_store import AssetNotFound, StoredAsset

PACK_ID = re.compile(r"^[a-z]{2}(?:\.[a-z0-9-]+)+$")
VERSION = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+$")
ASSET_ID = re.compile(r"^[a-z]{2}(?:\.[a-z0-9-]+){2,8}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
INDEX_NAME = "asset-index.json"


class AssetStoreError(AssetNotFound):
    """Base error for local asset lookup and integrity failures."""


class AssetIntegrityError(AssetStoreError):
    """Raised when a staged asset does not match its integrity index."""


class EmptyAssetStore:
    """Used when no staged display-asset root is configured."""

    def get(self, pack_id: str, version: str, asset_id: str) -> StoredAsset:
        raise AssetNotFound(f"未找到展示资产：{asset_id}")

    def list_assets(self, pack_id: str, version: str) -> Mapping[str, StoredAsset]:
        return {}


class LocalAssetStore:
    def __init__(self, root: Path) -> None:
        self._root = root.resolve()

    def get(self, pack_id: str, version: str, asset_id: str) -> StoredAsset:
        assets = self.list_assets(pack_id, version)
        asset = assets.get(asset_id)
        if asset is None:
            raise AssetNotFound(f"未找到展示资产：{asset_id}")
        return asset

    def list_assets(self, pack_id: str, version: str) -> Mapping[str, StoredAsset]:
        if (
            not PACK_ID.fullmatch(pack_id)
            or not VERSION.fullmatch(version)
        ):
            raise AssetNotFound(f"未找到资源包：{pack_id}@{version}")
        pack_dir = (self._root / pack_id / version).resolve()
        if not pack_dir.is_relative_to(self._root) or not pack_dir.is_dir():
            raise AssetNotFound(f"未找到资源包：{pack_id}@{version}")
        index_path = pack_dir / INDEX_NAME
        if not index_path.is_file():
            raise AssetNotFound(f"未找到资源包：{pack_id}@{version}")
        index = self._read_json(index_path)
        if (
            not isinstance(index, dict)
            or index.get("schema_version") != 1
            or index.get("pack_id") != pack_id
            or index.get("version") != version
        ):
            raise AssetIntegrityError(f"资源索引身份与目录不匹配：{index_path}")
        entries = index.get("assets")
        if not isinstance(entries, dict) or not entries:
            raise AssetIntegrityError(f"资源索引缺少资产清单：{index_path}")
        found: dict[str, StoredAsset] = {}
        for asset_id, meta in entries.items():
            if not isinstance(asset_id, str) or not ASSET_ID.fullmatch(asset_id):
                raise AssetIntegrityError(f"资源索引包含非法asset_id：{asset_id}")
            if not isinstance(meta, dict):
                raise AssetIntegrityError(f"资源索引条目格式错误：{asset_id}")
            digest = meta.get("sha256")
            fmt = meta.get("format")
            kind = meta.get("kind")
            size = meta.get("byte_size")
            relative = meta.get("path")
            if (
                not isinstance(digest, str)
                or not SHA256.fullmatch(digest)
                or not isinstance(fmt, str)
                or not isinstance(kind, str)
                or not isinstance(size, int)
                or size < 1
                or not isinstance(relative, str)
            ):
                raise AssetIntegrityError(f"资源索引条目无效：{asset_id}")
            file_path = (pack_dir / relative).resolve()
            if not file_path.is_relative_to(pack_dir) or not file_path.is_file():
                raise AssetIntegrityError(f"资源文件缺失或越界：{asset_id}")
            encoded = file_path.read_bytes()
            if len(encoded) != size or hashlib.sha256(encoded).hexdigest() != digest:
                raise AssetIntegrityError(f"资源文件哈希不匹配：{asset_id}")
            found[asset_id] = StoredAsset(
                asset_id=asset_id,
                pack_id=pack_id,
                version=version,
                sha256=digest,
                format=fmt,
                kind=kind,
                byte_size=size,
                path=file_path,
            )
        return MappingProxyType(found)

    @staticmethod
    def _read_json(path: Path) -> Any:
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
            raise AssetIntegrityError(f"无法读取资源索引：{path}") from error
