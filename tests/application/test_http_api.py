from __future__ import annotations

import asyncio

from aiohttp.test_utils import TestClient, TestServer
from museum.adapters.sqlite.database import SQLiteDatabase
from museum.main import create_app
from museum.ports.content_catalog import PublishedPack

ORIGIN = "http://localhost:5173"
PACK_ID = "cn.tang.core"
VERSION = "1.0.0"
ARTIFACT_ID = "cn.tang.artifact.stele"
FACT_ID = "cn.tang.fact.stele.date"
SOURCE_ID = "cn.tang.source.museum.stele"


class MemoryCatalog:
    def __init__(self) -> None:
        self.pack = PublishedPack(
            PACK_ID,
            VERSION,
            "1",
            {
                "manifest.json": {"id": PACK_ID, "version": VERSION},
                "artifacts/stele.json": {
                    "id": ARTIFACT_ID,
                    "title": "一佛二菩萨造像碑",
                    "aliases": ["佛碑"],
                    "museum": {"name": "艺术博物馆", "accession": "A-01"},
                    "time_range": {"start_year": 678, "end_year": 678, "precision": "year"},
                    "material": "石",
                    "category": "造像碑",
                    "asset_ids": [],
                    "fact_card_ids": [FACT_ID],
                    "story_entry_ids": [],
                },
                "facts/date.json": {
                    "id": FACT_ID,
                    "claim": "题记纪年为678年。",
                    "grade": "F",
                    "applicable_time": {
                        "start_year": 678,
                        "end_year": 678,
                        "precision": "year",
                    },
                    "source_ids": [SOURCE_ID],
                },
                "sources/museum.json": {
                    "id": SOURCE_ID,
                    "kind": "museum_record",
                    "title": "馆藏记录",
                    "locator": {"label": "作品页面", "url": "https://example.org/stele"},
                },
            },
        )

    def list_published(self):
        return ()

    def get_published(self, pack_id: str, version: str) -> PublishedPack:
        if (pack_id, version) != (PACK_ID, VERSION):
            raise LookupError("content version not found")
        return self.pack


def make_app(tmp_path):
    database = SQLiteDatabase(tmp_path / "http.sqlite3")
    catalog = MemoryCatalog()
    return create_app(database=database, catalog=catalog, allowed_origins=frozenset({ORIGIN}))


def test_http_session_pairing_context_and_command_flow(tmp_path) -> None:
    async def scenario() -> None:
        client = TestClient(TestServer(make_app(tmp_path)))
        await client.start_server()
        origin_headers = {"Origin": ORIGIN}
        created_response = await client.post(
            "/api/sessions",
            json={"pack_id": PACK_ID, "version": VERSION},
            headers=origin_headers,
        )
        assert created_response.status == 201
        created = await created_response.json()
        state = created["state"]
        session_id = state["session_id"]
        token = created["session_token"]
        assert state["pack_versions"] == {PACK_ID: VERSION}
        assert "focused_entity_id" not in state

        headers = {**origin_headers, "Authorization": f"Bearer {token}"}
        paired_response = await client.post(f"/api/sessions/{session_id}/pair", headers=headers)
        assert paired_response.status == 201
        paired = await paired_response.json()
        connection = paired["connection_id"]
        ticket = paired["control_ticket"]
        bound_headers = {**headers, "X-Museum-Connection": connection}

        context_response = await client.get(
            f"/api/sessions/{session_id}/context", headers=bound_headers
        )
        assert context_response.status == 200
        context = await context_response.json()
        assert context["focused_artifact"] is None
        assert context["visible_artifacts"] == []

        search_response = await client.get(
            f"/api/sessions/{session_id}/search?q=佛碑&kind=artifact",
            headers=bound_headers,
        )
        assert search_response.status == 200
        assert (await search_response.json())["items"][0]["id"] == ARTIFACT_ID

        command_payload = {
            "schema_version": "1",
            "request_id": "request-open-001",
            "expected_revision": 0,
            "interaction_epoch": 0,
            "control_ticket": ticket,
            "action": "open_artifact",
            "target_id": ARTIFACT_ID,
        }
        command_url = f"/api/sessions/{session_id}/commands"
        committed_response = await client.post(
            command_url, json=command_payload, headers=bound_headers
        )
        assert committed_response.status == 200
        committed = await committed_response.json()
        assert committed["status"] == "committed"
        replay_response = await client.post(
            command_url, json=command_payload, headers=bound_headers
        )
        assert replay_response.status == 200
        assert await replay_response.json() == committed

        fact_response = await client.get(
            f"/api/sessions/{session_id}/facts/{FACT_ID}", headers=bound_headers
        )
        assert fact_response.status == 200
        fact = await fact_response.json()
        assert fact["sources"][0]["id"] == SOURCE_ID

        replacement_response = await client.post(
            f"/api/sessions/{session_id}/pair", headers=headers
        )
        assert replacement_response.status == 201
        old_context = await client.get(f"/api/sessions/{session_id}/context", headers=bound_headers)
        assert old_context.status == 403

        rejected_origin = await client.post(
            f"/api/sessions/{session_id}/pair",
            headers={"Authorization": f"Bearer {token}", "Origin": "https://attacker.test"},
        )
        assert rejected_origin.status == 403
        cross_session = await client.get("/api/sessions/session-00000000", headers=bound_headers)
        assert cross_session.status == 401
        await client.close()

    asyncio.run(scenario())


def test_http_reads_use_sqlite_read_only_snapshot(tmp_path) -> None:
    async def scenario() -> None:
        client = TestClient(TestServer(make_app(tmp_path)))
        await client.start_server()
        response = await client.post(
            "/api/sessions",
            json={"pack_id": PACK_ID, "version": VERSION},
            headers={"Origin": ORIGIN},
        )
        created = await response.json()
        state = created["state"]
        session_id = state["session_id"]
        token = created["session_token"]
        get_response = await client.get(
            f"/api/sessions/{session_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert get_response.status == 200
        assert (await get_response.json()) == state
        await client.close()

    asyncio.run(scenario())


def test_create_session_rejects_unpublished_pack_and_untrusted_origin(tmp_path) -> None:
    async def scenario() -> None:
        client = TestClient(TestServer(make_app(tmp_path)))
        await client.start_server()
        missing = await client.post(
            "/api/sessions",
            json={"pack_id": "cn.tang.core", "version": "9.9.9"},
            headers={"Origin": ORIGIN},
        )
        assert missing.status == 404
        bad_origin = await client.post(
            "/api/sessions",
            json={"pack_id": PACK_ID, "version": VERSION},
            headers={"Origin": "https://attacker.test"},
        )
        assert bad_origin.status == 403
        await client.close()

    asyncio.run(scenario())
