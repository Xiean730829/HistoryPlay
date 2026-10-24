from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class PackReference:
    pack_id: str
    version: str


@dataclass(frozen=True)
class PublishedPack:
    pack_id: str
    version: str
    schema_version: str
    documents: Mapping[str, object]


class ContentCatalog(Protocol):
    """Read-only access to immutable published content versions."""

    def list_published(self) -> tuple[PackReference, ...]: ...

    def get_published(self, pack_id: str, version: str) -> PublishedPack: ...
