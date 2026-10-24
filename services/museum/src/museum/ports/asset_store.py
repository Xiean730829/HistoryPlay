from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol


class AssetNotFound(LookupError):
    """A requested display asset is not in the published local store."""


@dataclass(frozen=True, slots=True)
class StoredAsset:
    asset_id: str
    pack_id: str
    version: str
    sha256: str
    format: str
    kind: str
    byte_size: int
    path: Path


class AssetStore(Protocol):
    """Read-only access to staged, hash-addressed local display assets."""

    def get(self, pack_id: str, version: str, asset_id: str) -> StoredAsset: ...

    def list_assets(self, pack_id: str, version: str) -> Mapping[str, StoredAsset]: ...
