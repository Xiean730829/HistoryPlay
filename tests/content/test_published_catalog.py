from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest
from museum.adapters.content.published_catalog import (
    CatalogIntegrityError,
    PackNotFound,
    PublishedCatalog,
)


def stage_pack(root: Path, version: str, status: str = "published") -> Path:
    pack_dir = root / "cn.tang.core" / version
    pack_dir.mkdir(parents=True)
    manifest = {
        "id": "cn.tang.core",
        "version": version,
        "schema_version": "1",
        "publication_status": status,
    }
    artifact = {"id": f"cn.tang.core.artifact-a04-{version}", "title": version}
    documents = {
        "manifest.json": manifest,
        "artifacts/a04.json": artifact,
    }
    hashes: dict[str, str] = {}
    for name, data in documents.items():
        encoded = json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
        target = pack_dir / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(encoded)
        hashes[name] = hashlib.sha256(encoded).hexdigest()
    index = {
        "id": manifest["id"],
        "version": version,
        "schema_version": manifest["schema_version"],
        "publication_status": status,
        "files": hashes,
    }
    (pack_dir / "pack-index.json").write_text(
        json.dumps(index, ensure_ascii=False), encoding="utf-8"
    )
    return pack_dir


def test_catalog_loads_the_requested_version_and_keeps_versions_separate(
    tmp_path: Path,
) -> None:
    stage_pack(tmp_path, "0.1.0")
    stage_pack(tmp_path, "0.2.0")
    catalog = PublishedCatalog(tmp_path)

    older = catalog.get_published("cn.tang.core", "0.1.0")
    newer = catalog.get_published("cn.tang.core", "0.2.0")

    assert older.version == "0.1.0"
    assert newer.version == "0.2.0"
    older_artifact = older.documents["artifacts/a04.json"]
    newer_artifact = newer.documents["artifacts/a04.json"]
    assert isinstance(older_artifact, dict) and older_artifact["title"] == "0.1.0"
    assert isinstance(newer_artifact, dict) and newer_artifact["title"] == "0.2.0"
    assert {item.version for item in catalog.list_published()} == {"0.1.0", "0.2.0"}


def test_catalog_hides_unpublished_packs_from_reads_and_listing(tmp_path: Path) -> None:
    stage_pack(tmp_path, "0.1.0", status="draft")
    catalog = PublishedCatalog(tmp_path)

    assert catalog.list_published() == ()
    with pytest.raises(PackNotFound, match="尚未发布"):
        catalog.get_published("cn.tang.core", "0.1.0")


def test_catalog_rejects_tampered_content(tmp_path: Path) -> None:
    pack_dir = stage_pack(tmp_path, "0.1.0")
    (pack_dir / "artifacts/a04.json").write_text('{"title":"tampered"}', encoding="utf-8")

    with pytest.raises(CatalogIntegrityError, match="哈希不匹配"):
        PublishedCatalog(tmp_path).get_published("cn.tang.core", "0.1.0")


@pytest.mark.parametrize(
    ("pack_id", "version"),
    [("../outside", "0.1.0"), ("cn.tang.core", "../../outside")],
)
def test_catalog_rejects_path_like_identifiers(tmp_path: Path, pack_id: str, version: str) -> None:
    with pytest.raises(PackNotFound):
        PublishedCatalog(tmp_path).get_published(pack_id, version)
