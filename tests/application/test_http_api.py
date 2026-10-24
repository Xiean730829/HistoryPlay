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
ARTIFACT_TWO_ID = "cn.tang.artifact.bowl"
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
                "artifacts/bowl.json": {
                    "id": ARTIFACT_TWO_ID,
                    "title": "唐代花鸟纹银香囊",
                    "aliases": [],
                    "museum": {"name": "艺术博物馆", "accession": "A-02"},
                    "time_range": {"start_year": 700, "end_year": 799, "precision": "century"},
                    "material": "银",
                    "category": "香具",
                    "asset_ids": [],
                    "fact_card_ids": [],
                    "story_entry_ids": [],
                },
                "galleries/main.json": {
                    "id": "cn.tang.gallery.main",
                    "title": "唐朝长廊",
                    "region": {"id": "cn", "label": "中国"},
                    "status": "open",
                    "default_station_id": "cn.tang.station.stele",
                    "stations": [
                        {
                            "id": "cn.tang.station.stele",
                            "order": 0,
                            "time_range": {
                                "start_year": 678,
                                "end_year": 678,
                                "precision": "year",
                            },
                            "placement_basis": "明确纪年入口。",
                            "artifact_id": ARTIFACT_ID,
                            "side": "center",
                        },
                        {
                            "id": "cn.tang.station.bowl",
                            "order": 1,
                            "time_range": {
                                "start_year": 700,
                                "end_year": 799,
                                "precision": "century",
                            },
                            "placement_basis": "第二展位。",
                            "artifact_id": ARTIFACT_TWO_ID,
                            "side": "right",
                        },
                    ],
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

        gallery_response = await client.get(
            f"/api/sessions/{session_id}/galleries/cn.tang.gallery.main",
            headers=bound_headers,
        )
        assert gallery_response.status == 200
        gallery = await gallery_response.json()
        assert [item["order"] for item in gallery["stations"]] == [0, 1]
        assert [item["artifact"]["id"] for item in gallery["stations"]] == [
            ARTIFACT_ID,
            ARTIFACT_TWO_ID,
        ]
        assert gallery["visible_artifacts"] == []

        context_after_gallery_response = await client.get(
            f"/api/sessions/{session_id}/context", headers=bound_headers
        )
        assert context_after_gallery_response.status == 200
        context_after_gallery = await context_after_gallery_response.json()
        assert context_after_gallery["revision"] == context["revision"]

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


def test_event_stream_replays_events_and_ignores_stale_render_receipt(tmp_path) -> None:
    async def scenario() -> None:
        client = TestClient(TestServer(make_app(tmp_path)))
        await client.start_server()
        origin = {"Origin": ORIGIN}
        created = await client.post(
            "/api/sessions",
            json={"pack_id": PACK_ID, "version": VERSION},
            headers=origin,
        )
        state = (await created.json())["state"]
        session_id = state["session_id"]
        token = (await created.json())["session_token"]
        headers = {**origin, "Authorization": f"Bearer {token}"}
        paired = await client.post(f"/api/sessions/{session_id}/pair", headers=headers)
        binding = await paired.json()
        bound = {**headers, "X-Museum-Connection": binding["connection_id"]}
        event_ticket_response = await client.post(
            f"/api/sessions/{session_id}/events/ticket", headers=bound
        )
        event_ticket = (await event_ticket_response.json())["ticket"]
        event_protocols = ["museum-events.v1", f"museum-ticket.{event_ticket}"]

        socket = await client.ws_connect(
            f"/api/sessions/{session_id}/events?after_seq=0",
            protocols=event_protocols,
            headers=origin,
        )
        command = {
            "schema_version": "1",
            "request_id": "request-render-001",
            "expected_revision": 0,
            "interaction_epoch": 0,
            "control_ticket": binding["control_ticket"],
            "action": "open_artifact",
            "target_id": ARTIFACT_ID,
        }
        response = await client.post(
            f"/api/sessions/{session_id}/commands", json=command, headers=bound
        )
        receipt = await response.json()
        pushed = await socket.receive_json(timeout=1)
        assert pushed["type"] == "event"
        assert pushed["event"]["event_seq"] == 1

        render_receipt = {
            "request_id": receipt["request_id"],
            "payload_digest": receipt["payload_digest"],
            "revision": receipt["revision"],
            "view_revision": receipt["view_revision"],
            "interaction_epoch": receipt["interaction_epoch"],
            "status": "rendered",
        }
        rendered = await client.post(
            f"/api/sessions/{session_id}/render-receipts",
            json=render_receipt,
            headers=bound,
        )
        assert rendered.status == 200
        assert (await rendered.json())["status"] == "rendered"

        replay_ticket = await client.post(
            f"/api/sessions/{session_id}/events/ticket", headers=bound
        )
        replay_token = (await replay_ticket.json())["ticket"]
        replay = await client.ws_connect(
            f"/api/sessions/{session_id}/events?after_seq=0",
            protocols=["museum-events.v1", f"museum-ticket.{replay_token}"],
            headers=origin,
        )
        replayed = await replay.receive_json(timeout=1)
        assert replayed["event"]["event_seq"] == 1

        snapshot_ticket = await client.post(
            f"/api/sessions/{session_id}/events/ticket", headers=bound
        )
        snapshot_token = (await snapshot_ticket.json())["ticket"]
        snapshot = await client.ws_connect(
            f"/api/sessions/{session_id}/events",
            protocols=["museum-events.v1", f"museum-ticket.{snapshot_token}"],
            headers=origin,
        )
        snapshot_message = await snapshot.receive_json(timeout=1)
        assert snapshot_message["type"] == "snapshot"
        assert snapshot_message["event_seq"] == 1

        newer = {
            **command,
            "request_id": "request-render-002",
            "expected_revision": 1,
            "interaction_epoch": 1,
            "action": "open_artifact",
            "target_id": ARTIFACT_TWO_ID,
        }
        newer_response = await client.post(
            f"/api/sessions/{session_id}/commands", json=newer, headers=bound
        )
        assert (await newer_response.json())["revision"] == 2
        stale = await client.post(
            f"/api/sessions/{session_id}/render-receipts",
            json=render_receipt,
            headers=bound,
        )
        assert stale.status == 409
        await socket.close()
        await replay.close()
        await snapshot.close()
        await client.close()

    asyncio.run(scenario())
