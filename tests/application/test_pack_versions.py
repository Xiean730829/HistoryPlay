from __future__ import annotations

from dataclasses import replace

import pytest
from museum.application.pack_versions import (
    ConflictingDependency,
    CyclicDependency,
    MissingDependency,
    resolve_runtime_pack_versions,
)
from museum.ports.content_catalog import PackReference, PublishedPack

ROOT_ID = "cn.tang.core"
ROOT_VERSION = "1.0.0"
DEP_ID = "iq.abbasid.core"
DEP_VERSION = "0.1.0"


def make_pack(
    pack_id: str,
    version: str,
    dependencies: tuple[PackReference, ...] = (),
    *,
    artifact_id: str | None = None,
) -> PublishedPack:
    identity = artifact_id or f"{pack_id}.artifact.sample"
    documents = {
        "manifest.json": {
            "id": pack_id,
            "version": version,
            "publication_status": "published",
            "dependencies": [
                {"pack_id": item.pack_id, "version": item.version} for item in dependencies
            ],
        },
        "artifacts/sample.json": {"id": identity, "title": pack_id},
    }
    return PublishedPack(pack_id, version, "1", documents, dependencies)


class MemoryCatalog:
    def __init__(self, *packs: PublishedPack) -> None:
        self.packs = {(pack.pack_id, pack.version): pack for pack in packs}
        self.requests: list[tuple[str, str]] = []

    def list_published(self):
        raise AssertionError("运行时依赖解析不得扫描全部已发布包")

    def get_published(self, pack_id: str, version: str) -> PublishedPack:
        self.requests.append((pack_id, version))
        try:
            return self.packs[(pack_id, version)]
        except KeyError as error:
            raise LookupError(f"未找到已发布内容包：{pack_id}@{version}") from error


def test_session_pins_root_and_declared_dependency_versions() -> None:
    catalog = MemoryCatalog(
        make_pack(ROOT_ID, ROOT_VERSION, (PackReference(DEP_ID, DEP_VERSION),)),
        make_pack(DEP_ID, DEP_VERSION),
        make_pack(DEP_ID, "9.9.9"),
    )

    pinned = resolve_runtime_pack_versions(catalog, ROOT_ID, ROOT_VERSION)

    assert pinned == {ROOT_ID: ROOT_VERSION, DEP_ID: DEP_VERSION}
    assert (DEP_ID, "9.9.9") not in catalog.requests


def test_missing_dependency_is_rejected_without_scanning_latest() -> None:
    catalog = MemoryCatalog(
        make_pack(ROOT_ID, ROOT_VERSION, (PackReference(DEP_ID, DEP_VERSION),)),
        make_pack(DEP_ID, "9.9.9"),
    )

    with pytest.raises(MissingDependency, match="iq.abbasid.core@0.1.0"):
        resolve_runtime_pack_versions(catalog, ROOT_ID, ROOT_VERSION)
    assert (DEP_ID, "9.9.9") not in catalog.requests


def test_dependency_cycle_is_rejected() -> None:
    catalog = MemoryCatalog(
        make_pack(ROOT_ID, ROOT_VERSION, (PackReference(DEP_ID, DEP_VERSION),)),
        make_pack(DEP_ID, DEP_VERSION, (PackReference(ROOT_ID, ROOT_VERSION),)),
    )

    with pytest.raises(CyclicDependency, match="形成循环"):
        resolve_runtime_pack_versions(catalog, ROOT_ID, ROOT_VERSION)


def test_conflicting_dependency_versions_are_rejected() -> None:
    nested = "iq.abbasid.shared"
    catalog = MemoryCatalog(
        make_pack(
            ROOT_ID,
            ROOT_VERSION,
            (PackReference(DEP_ID, DEP_VERSION), PackReference(nested, "1.0.0")),
        ),
        make_pack(DEP_ID, DEP_VERSION, (PackReference(nested, "2.0.0"),)),
        make_pack(nested, "1.0.0"),
        make_pack(nested, "2.0.0"),
    )

    with pytest.raises(ConflictingDependency, match="多个版本"):
        resolve_runtime_pack_versions(catalog, ROOT_ID, ROOT_VERSION)


def test_unpublished_root_still_raises_lookup_error() -> None:
    catalog = MemoryCatalog(make_pack(DEP_ID, DEP_VERSION))

    with pytest.raises(LookupError, match="cn.tang.core@1.0.0"):
        resolve_runtime_pack_versions(catalog, ROOT_ID, ROOT_VERSION)


def test_manifest_dependencies_are_used_when_index_field_is_empty() -> None:
    pack = replace(
        make_pack(ROOT_ID, ROOT_VERSION),
        dependencies=(),
        documents={
            "manifest.json": {
                "id": ROOT_ID,
                "version": ROOT_VERSION,
                "dependencies": [{"pack_id": DEP_ID, "version": DEP_VERSION}],
            }
        },
    )
    catalog = MemoryCatalog(pack, make_pack(DEP_ID, DEP_VERSION))

    assert resolve_runtime_pack_versions(catalog, ROOT_ID, ROOT_VERSION) == {
        ROOT_ID: ROOT_VERSION,
        DEP_ID: DEP_VERSION,
    }
