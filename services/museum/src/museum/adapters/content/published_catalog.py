from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from types import MappingProxyType
from typing import Any

from museum.ports.content_catalog import PackReference, PublishedContentUnavailable, PublishedPack

PACK_ID = re.compile(r"^[a-z]{2}(?:\.[a-z0-9-]+)+$")
VERSION = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
INDEX_NAME = "pack-index.json"
MANIFEST_NAME = "manifest.json"


class CatalogError(PublishedContentUnavailable):
    """Base error for catalog lookup and integrity failures."""


class PackNotFound(CatalogError):
    """Raised when the requested published pack version does not exist."""


class CatalogIntegrityError(CatalogError):
    """Raised when a staged pack does not match its integrity index."""


class PublishedCatalog:
    def __init__(self, root: Path) -> None:
        self._root = root.resolve()

    def list_published(self) -> tuple[PackReference, ...]:
        if not self._root.is_dir():
            return ()
        found: list[PackReference] = []
        for pack_dir in sorted(self._root.iterdir()):
            if not pack_dir.is_dir() or not PACK_ID.fullmatch(pack_dir.name):
                continue
            for version_dir in sorted(pack_dir.iterdir()):
                if not version_dir.is_dir() or not VERSION.fullmatch(version_dir.name):
                    continue
                if not (version_dir / INDEX_NAME).is_file():
                    continue
                try:
                    pack = self.get_published(pack_dir.name, version_dir.name)
                except PackNotFound:
                    continue
                found.append(PackReference(pack.pack_id, pack.version))
        return tuple(found)

    def get_published(self, pack_id: str, version: str) -> PublishedPack:
        if not PACK_ID.fullmatch(pack_id) or not VERSION.fullmatch(version):
            raise PackNotFound(f"未找到已发布内容包：{pack_id}@{version}")
        pack_dir = (self._root / pack_id / version).resolve()
        if not pack_dir.is_relative_to(self._root):
            raise PackNotFound(f"未找到已发布内容包：{pack_id}@{version}")
        index_path = pack_dir / INDEX_NAME
        if not index_path.is_file():
            raise PackNotFound(f"未找到已发布内容包：{pack_id}@{version}")

        index = self._read_json(index_path)
        if not isinstance(index, dict):
            raise CatalogIntegrityError(f"内容包索引格式错误：{index_path}")
        if index.get("id") != pack_id or index.get("version") != version:
            raise CatalogIntegrityError(f"内容包索引身份与目录不匹配：{index_path}")
        files = index.get("files")
        if not isinstance(files, dict) or MANIFEST_NAME not in files:
            raise CatalogIntegrityError(f"内容包索引缺少文件清单：{index_path}")

        documents: dict[str, object] = {}
        for relative_name, expected_hash in files.items():
            if not isinstance(relative_name, str) or not isinstance(expected_hash, str):
                raise CatalogIntegrityError(f"内容包索引条目格式错误：{index_path}")
            if relative_name == INDEX_NAME or not SHA256.fullmatch(expected_hash):
                raise CatalogIntegrityError(f"内容包索引条目无效：{relative_name}")
            file_path = (pack_dir / relative_name).resolve()
            if not file_path.is_relative_to(pack_dir) or not file_path.is_file():
                raise CatalogIntegrityError(f"内容包文件缺失或越界：{relative_name}")
            encoded = file_path.read_bytes()
            if hashlib.sha256(encoded).hexdigest() != expected_hash:
                raise CatalogIntegrityError(f"内容包文件哈希不匹配：{relative_name}")
            documents[relative_name] = self._decode_json(encoded, file_path)

        manifest = documents.get(MANIFEST_NAME)
        if not isinstance(manifest, dict):
            raise CatalogIntegrityError(f"内容包缺少有效清单：{pack_dir}")
        if manifest.get("id") != pack_id or manifest.get("version") != version:
            raise CatalogIntegrityError(f"内容包身份与目录不匹配：{pack_dir}")
        status = manifest.get("publication_status")
        if status != "published":
            raise PackNotFound(f"内容包尚未发布：{pack_id}@{version}")
        schema_version = manifest.get("schema_version")
        if not isinstance(schema_version, str) or index.get("schema_version") != schema_version:
            raise CatalogIntegrityError(f"内容包Schema版本与索引不匹配：{pack_dir}")
        if index.get("publication_status") != status:
            raise CatalogIntegrityError(f"内容包发布状态与索引不匹配：{pack_dir}")
        return PublishedPack(
            pack_id=pack_id,
            version=version,
            schema_version=schema_version,
            documents=MappingProxyType(documents),  # type: ignore[arg-type]
        )

    @staticmethod
    def _read_json(path: Path) -> Any:
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
            raise CatalogIntegrityError(f"无法读取内容包JSON：{path}") from error

    @classmethod
    def _decode_json(cls, encoded: bytes, path: Path) -> object:
        try:
            return json.loads(encoded.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise CatalogIntegrityError(f"内容包JSON格式错误：{path}") from error
