from __future__ import annotations

import asyncio
import hashlib
from pathlib import Path

from aiohttp.test_utils import TestClient, TestServer
from museum.adapters.assets.local_store import LocalAssetStore
from museum.adapters.sqlite.database import SQLiteDatabase
from museum.main import create_app
from museum.ports.asset_store import StoredAsset
from museum.ports.content_catalog import PublishedPack

ORIGIN = "http://localhost:5173"
PACK_ID = "cn.tang.core"
VERSION = "1.0.0"
ASSET_ID = "cn.tang.asset.stele.preview"
PNG = b"\x89PNG\r\n\x1a\npreview-bytes"
DIGEST = hashlib.sha256(PNG).hexdigest()


class MemoryCatalog:
    def __init__(self) -> None:
        self.pack = PublishedPack(
            PACK_ID,
            VERSION,
            "1",
            {
                "manifest.json": {
                    "id": PACK_ID,
                    "version": VERSION,
                    "publication_status": "published",
                },
                "assets/stele.preview.json": {
                    "id": ASSET_ID,
                    "kind": "preview",
                    "format": "png",
                    "sha256": DIGEST,
                    "byte_size": len(PNG),
                },
            },
        )

    def list_published(self):
        return ()

    def get_published(self, pack_id: str, version: str) -> PublishedPack:
        if (pack_id, version) != (PACK_ID, VERSION):
            raise LookupError("content version not found")
        return self.pack


class MemoryAssets:
    def __init__(self, path: Path) -> None:
        path.write_bytes(PNG)
        self.asset = StoredAsset(
            asset_id=ASSET_ID,
            pack_id=PACK_ID,
            version=VERSION,
            sha256=DIGEST,
            format="png",
            kind="preview",
            byte_size=len(PNG),
            path=path,
        )

    def get(self, pack_id: str, version: str, asset_id: str) -> StoredAsset:
        if (pack_id, version, asset_id) != (PACK_ID, VERSION, ASSET_ID):
            raise LookupError("asset not found")
        return self.asset

    def list_assets(self, pack_id: str, version: str):
        return {ASSET_ID: self.asset}


def _make_app(tmp_path: Path, assets=None):
    database = SQLiteDatabase(tmp_path / "http.sqlite3")
    return create_app(
        database=database,
        catalog=MemoryCatalog(),
        assets=assets or MemoryAssets(tmp_path / "preview.png"),
        allowed_origins=frozenset({ORIGIN}),
    )


def test_asset_route_serves_bytes_with_hash_and_origin(tmp_path: Path) -> None:
    async def scenario() -> None:
        client = TestClient(TestServer(_make_app(tmp_path)))
        await client.start_server()
        created = await client.post(
            "/api/sessions",
            json={"pack_id": PACK_ID, "version": VERSION},
            headers={"Origin": ORIGIN},
        )
        payload = await created.json()
        session_id = payload["state"]["session_id"]
        headers = {
            "Origin": ORIGIN,
            "Authorization": f"Bearer {payload['session_token']}",
        }
        response = await client.get(
            f"/api/sessions/{session_id}/assets/{ASSET_ID}", headers=headers
        )
        assert response.status == 200
        assert await response.read() == PNG
        assert response.headers["Content-Type"] == "image/png"
        assert response.headers["ETag"] == f'"{DIGEST}"'
        assert response.headers["Access-Control-Allow-Origin"] == ORIGIN
        await client.close()

    asyncio.run(scenario())


def test_asset_route_rejects_unknown_path_and_untrusted_origin(tmp_path: Path) -> None:
    async def scenario() -> None:
        client = TestClient(TestServer(_make_app(tmp_path)))
        await client.start_server()
        created = await client.post(
            "/api/sessions",
            json={"pack_id": PACK_ID, "version": VERSION},
            headers={"Origin": ORIGIN},
        )
        payload = await created.json()
        session_id = payload["state"]["session_id"]
        token = payload["session_token"]
        missing = await client.get(
            f"/api/sessions/{session_id}/assets/cn.tang.asset.missing.preview",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert missing.status == 404
        traversal = await client.get(
            f"/api/sessions/{session_id}/assets/..%2F..%2Fwindows%2Fwin.ini",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert traversal.status in {400, 404}
        untrusted = await client.get(
            f"/api/sessions/{session_id}/assets/{ASSET_ID}",
            headers={
                "Authorization": f"Bearer {token}",
                "Origin": "https://attacker.test",
            },
        )
        assert untrusted.status == 403
        await client.close()

    asyncio.run(scenario())


def test_local_store_rejects_missing_file_and_path_escape(tmp_path: Path) -> None:
    root = tmp_path / "assets"
    pack_dir = root / PACK_ID / VERSION
    pack_dir.mkdir(parents=True)
    stored = pack_dir / "files"
    stored.mkdir()
    file_path = stored / f"{DIGEST}.png"
    file_path.write_bytes(PNG)
    (pack_dir / "asset-index.json").write_text(
        '{"schema_version":1,"pack_id":"cn.tang.core","version":"1.0.0","assets":{"'
        + ASSET_ID
        + '":{"sha256":"'
        + DIGEST
        + '","format":"png","kind":"preview","byte_size":'
        + str(len(PNG))
        + ',"path":"files/'
        + DIGEST
        + '.png"}}}',
        encoding="utf-8",
    )
    store = LocalAssetStore(root)
    asset = store.get(PACK_ID, VERSION, ASSET_ID)
    assert asset.path.read_bytes() == PNG
    (pack_dir / "asset-index.json").write_text(
        '{"schema_version":1,"pack_id":"cn.tang.core","version":"1.0.0","assets":{"'
        + ASSET_ID
        + '":{"sha256":"'
        + DIGEST
        + '","format":"png","kind":"preview","byte_size":'
        + str(len(PNG))
        + ',"path":"../secret.png"}}}',
        encoding="utf-8",
    )
    try:
        store.get(PACK_ID, VERSION, ASSET_ID)
        raise AssertionError("expected path escape rejection")
    except LookupError as error:
        assert "越界" in str(error) or "缺失" in str(error)
