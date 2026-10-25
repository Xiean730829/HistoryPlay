from __future__ import annotations

import asyncio
from dataclasses import replace

import pytest
from aiohttp import ClientSession
from aiohttp.test_utils import TestClient, TestServer
from museum.adapters.http.helpers import SERVICES_KEY
from museum.adapters.sqlite.database import SQLiteDatabase
from museum.main import create_app
from museum.ports.content_catalog import PublishedPack
from museum_mcp.action_tools import ActionTools, TrustedInput, VoiceApplicationClient
from museum_mcp.application_client import BoundSession, GatewayError

ORIGIN = "http://127.0.0.1:5174"


class Catalog:
    def __init__(self):
        artifacts = {}
        stations = []
        for index, name in enumerate(("coin", "bull")):
            identifier = f"cn.tang.artifact.{name}"
            artifacts[f"artifacts/{name}.json"] = {
                "id": identifier,
                "title": name,
                "museum": {"name": "fixture"},
                "time_range": {"start_year": 700, "end_year": 700, "precision": "year"},
                "material": "铜",
                "category": "test",
                "asset_ids": [],
                "fact_card_ids": [],
                "story_entry_ids": [],
            }
            stations.append(
                {
                    "id": f"cn.tang.station.{name}",
                    "order": index,
                    "artifact_id": identifier,
                    "time_range": {"start_year": 700, "end_year": 700, "precision": "year"},
                    "placement_basis": "测试",
                }
            )
        self.pack = PublishedPack(
            "cn.tang.core",
            "1.0.0",
            "1",
            {
                "manifest.json": {"id": "cn.tang.core", "version": "1.0.0"},
                **artifacts,
                "galleries/main.json": {
                    "id": "cn.tang.gallery.main",
                    "title": "测试长廊",
                    "status": "open",
                    "region": {"id": "cn", "label": "中国"},
                    "default_station_id": "cn.tang.station.coin",
                    "stations": stations,
                },
            },
        )

    def get_published(self, pack_id, version):
        if (pack_id, version) != (self.pack.pack_id, self.pack.version):
            raise LookupError("未知测试包")
        return self.pack


async def game_fixture(tmp_path, *, renders=None):
    app = create_app(
        database=SQLiteDatabase(tmp_path / "voice.sqlite3"),
        catalog=Catalog(),
        allowed_origins=frozenset({ORIGIN}),
    )
    services = app[SERVICES_KEY]
    if renders is not None:
        services = replace(services, renders=renders)
        app[SERVICES_KEY] = services
    server = TestServer(app)
    await server.start_server()
    base_url = str(server.make_url("/")).rstrip("/")
    async with ClientSession() as http:
        async with http.post(
            f"{base_url}/api/sessions",
            headers={"Origin": ORIGIN},
            json={"pack_id": "cn.tang.core", "version": "1.0.0"},
        ) as response:
            created = await response.json()
        session_id = created["state"]["session_id"]
        headers = {"Origin": ORIGIN, "Authorization": f"Bearer {created['session_token']}"}
        async with http.post(
            f"{base_url}/api/sessions/{session_id}/pair", headers=headers
        ) as response:
            paired = await response.json()
        headers["X-Museum-Connection"] = paired["connection_id"]
        async with http.post(
            f"{base_url}/api/sessions/{session_id}/commands",
            headers=headers,
            json={
                "schema_version": "1",
                "request_id": "enter-gallery-fixture",
                "expected_revision": 0,
                "expected_view_revision": 0,
                "interaction_epoch": 0,
                "control_ticket": paired["control_ticket"],
                "action": "enter_gallery",
                "target_id": "cn.tang.gallery.main",
            },
        ) as response:
            assert response.status == 200
            entered = await response.json()
    binding = BoundSession(base_url, session_id, created["session_token"], paired["connection_id"])
    return server, binding, entered


def test_real_http_action_uses_original_pair_and_old_scope_stays_invalid_after_context(tmp_path):
    async def run():
        server, binding, _ = await game_fixture(tmp_path)
        client = VoiceApplicationClient(binding, origin=ORIGIN)
        try:
            bridge = (await client.voice("bind"))["bridge_token"]
            first = (await client.voice("begin", bridge_token=bridge))["input_token"]
            current = (await client.voice("begin", bridge_token=bridge))["input_token"]
            old_tools = ActionTools(client, TrustedInput(bridge, first))
            await client.get("context")
            with pytest.raises(GatewayError, match="403"):
                await old_tools.act("next")
            result = await ActionTools(client, TrustedInput(bridge, current)).act("next")
            assert result["receipt"]["status"] == "committed"
            assert (await client.state())["focused_entity_id"] == "cn.tang.artifact.bull"
            with pytest.raises(GatewayError, match="403"):
                await old_tools.act("previous")
            with pytest.raises(GatewayError, match="403"):
                await ActionTools(client, TrustedInput(bridge, current)).act("previous")
        finally:
            await server.close()

    asyncio.run(run())


def test_browser_pcm_to_current_transport_stt_to_real_game_http(tmp_path, monkeypatch):
    from dataclasses import asdict
    from types import SimpleNamespace

    from aiohttp import WSMsgType
    from museum_voice import main as voice_main
    from museum_voice.config import DeviceConfig

    async def run():
        game, binding, _ = await game_fixture(tmp_path)
        queue = asyncio.Queue()
        encoded = []

        class Upstream:
            async def send_json(self, data):
                if data.get("state") == "stop":
                    await queue.put(
                        SimpleNamespace(type=WSMsgType.TEXT, data='{"type":"stt","text":"往前走"}')
                    )

            async def receive_json(self):
                return {"type": "hello", "transport": "websocket", "session_id": "fake-upstream"}

            async def send_bytes(self, data):
                encoded.append(data)

            def __aiter__(self):
                return self

            async def __anext__(self):
                message = await queue.get()
                if message is None:
                    raise StopAsyncIteration
                return message

            async def close(self):
                await queue.put(None)

        upstream = Upstream()

        class FakeSession:
            def __init__(self, **kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                await upstream.close()

            async def ws_connect(self, url, **kwargs):
                assert kwargs["headers"]["Device-Id"] == "aa:bb:cc:dd:ee:ff"
                return upstream

        monkeypatch.setattr(voice_main, "ClientSession", FakeSession)
        device = DeviceConfig(
            "aa:bb:cc:dd:ee:ff",
            "4032ca38-fd23-4844-9f8a-e97035b0838c",
            "wss://api.xiaozhi.me/v1/",
            "fake-test-token",
        )
        binding_file = tmp_path / "private-current-binding.json"
        app = voice_main.create_app(device, port=8782, origin=ORIGIN, binding_file=binding_file)
        browser = TestClient(TestServer(app))
        await browser.start_server()
        headers = {"Host": "127.0.0.1:8782", "Origin": ORIGIN}
        try:
            response = await browser.post("/voice/bind", headers=headers, json=asdict(binding))
            assert response.status == 200
            bound = await response.json()
            assert set(bound) == {"binding_id", "status"}
            import json

            assert (
                json.loads(binding_file.read_text(encoding="utf-8"))["connection_id"]
                == binding.connection_id
            )
            ws = await browser.ws_connect("/voice/ws", headers=headers)
            await ws.send_json({"op": "bind", "binding_id": bound["binding_id"]})
            assert (await ws.receive_json())["type"] == "ready"
            await ws.send_json({"op": "start", "mode": "manual"})
            for _ in range(3):
                await ws.send_bytes(bytes(640))
            await ws.send_json({"op": "stop"})
            while True:
                event = await asyncio.wait_for(ws.receive_json(), 5)
                if event.get("type") == "control":
                    break
            assert event["result"]["receipt"]["status"] == "committed"
            assert encoded
            client = VoiceApplicationClient(binding, origin=ORIGIN)
            assert (await client.state())["focused_entity_id"] == "cn.tang.artifact.bull"
            revision = (await client.state())["revision"]
            await queue.put(
                SimpleNamespace(type=WSMsgType.TEXT, data='{"type":"stt","text":"往后走"}')
            )
            await asyncio.sleep(0.02)
            assert (await client.state())["revision"] == revision
            await ws.close()
        finally:
            await browser.close()
            await game.close()

    asyncio.run(run())


def test_camera_requires_current_rendered_receipt_not_degraded_or_pending_target(tmp_path):
    async def run():
        server, binding, entered = await game_fixture(tmp_path)
        client = VoiceApplicationClient(binding, origin=ORIGIN)
        headers = {
            "Authorization": f"Bearer {binding.session_token}",
            "X-Museum-Connection": binding.connection_id,
            "Origin": ORIGIN,
        }
        try:
            bridge = (await client.voice("bind"))["bridge_token"]
            token = (await client.voice("begin", bridge_token=bridge))["input_token"]
            scope = TrustedInput(bridge, token)
            assert (await client.voice("view", scope=scope))["status"] == "pending"
            with pytest.raises(GatewayError, match="尚未完整呈现"):
                await ActionTools(client, scope).act("back")
            acknowledgement = {
                key: entered[key]
                for key in (
                    "request_id",
                    "payload_digest",
                    "revision",
                    "view_revision",
                    "interaction_epoch",
                )
            }
            async with ClientSession() as http:
                response = await http.post(
                    f"{binding.base_url}/api/sessions/{binding.session_id}/render-receipts",
                    headers=headers,
                    json={**acknowledgement, "status": "degraded", "reason": "照片降级"},
                )
                assert response.status == 200
                await response.release()
                with pytest.raises(GatewayError, match="尚未完整呈现"):
                    await ActionTools(client, scope).act("back")
                response = await http.post(
                    f"{binding.base_url}/api/sessions/{binding.session_id}/render-receipts",
                    headers=headers,
                    json={**acknowledgement, "status": "rendered"},
                )
                assert response.status == 200
                await response.release()
            result = await ActionTools(client, scope).act("back")
            assert result["receipt"]["status"] == "committed"
            assert (await client.state())["camera_pose"]["yaw"] == -180
            assert (await client.voice("view", scope=scope))["status"] == "pending"
        finally:
            await server.close()

    asyncio.run(run())
