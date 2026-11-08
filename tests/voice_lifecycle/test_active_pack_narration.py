"""Local acceptance regression against the actual published expansion pack.

No microphone, upstream device or saved browser pairing is used. This exercises
real session HTTP, spoken lookup, trusted actions and the returned background
node contract together, rather than inventing artifact-shaped paragraphs.
"""
import asyncio
from pathlib import Path

import aiohttp
import pytest
from aiohttp.test_utils import TestServer
from museum.adapters.content.published_catalog import PublishedCatalog
from museum.adapters.sqlite.database import SQLiteDatabase
from museum.main import create_app
from museum_mcp.action_tools import TrustedInput, VoiceApplicationClient
from museum_mcp.application_client import BoundSession
from museum_voice.control_orchestrator import InputOrchestrator, SpokenSelection

ROOT = Path(__file__).resolve().parents[2]
PUBLISHED = ROOT / ".local/expansion/tang-full/published"
ORIGIN = "http://127.0.0.1:5190"
CASES = [
    ("牛", "gilt-bronze-bull"), ("铜钱", "kaiyuan-coin"),
    ("佛像", "votive-stele"), ("弹拨乐俑", "lute-musician"),
    ("吹笛乐俑", "flute-musician"), ("明尼阿波利斯女俑", "woman-figure-mia"),
    ("抚顶浮雕", "buddha-follower"), ("守门力士", "dvarapala"),
]


@pytest.mark.skipif(not (PUBLISHED / "cn.tang.core/0.3.3/manifest.json").exists(),
                    reason="Local published 0.3.3 expansion is not installed")
def test_all_eight_artifacts_locate_and_read_their_own_background(tmp_path):
    async def run():
        app = create_app(database=SQLiteDatabase(tmp_path / "museum.sqlite3"),
                         catalog=PublishedCatalog(PUBLISHED),
                         allowed_origins=frozenset({ORIGIN}))
        server = TestServer(app)
        await server.start_server()
        base = str(server.make_url("/")).rstrip("/")
        try:
            async with aiohttp.ClientSession() as http:
                async with http.post(base + "/api/sessions", headers={"Origin": ORIGIN},
                                     json={"pack_id": "cn.tang.core", "version": "0.3.3"}) as r:
                    assert r.status == 201
                    created = await r.json()
                sid = created["state"]["session_id"]
                headers = {"Origin": ORIGIN, "Authorization": "Bearer " + created["session_token"]}
                async with http.post(f"{base}/api/sessions/{sid}/pair", headers=headers) as r:
                    paired = await r.json()
                headers["X-Museum-Connection"] = paired["connection_id"]
                async with http.post(f"{base}/api/sessions/{sid}/commands", headers=headers, json={
                    "schema_version": "1", "request_id": "regression-enter", "expected_revision": 0,
                    "expected_view_revision": 0, "interaction_epoch": 0,
                    "control_ticket": paired["control_ticket"], "action": "enter_gallery",
                    "target_id": "cn.tang.gallery.main",
                }) as r:
                    assert (await r.json())["status"] == "committed"
            client = VoiceApplicationClient(BoundSession(
                base, sid, created["session_token"], paired["connection_id"]), origin=ORIGIN)
            bridge = (await client.voice("bind"))["bridge_token"]

            async def speak(text, selection=None):
                token = (await client.voice("begin", bridge_token=bridge))["input_token"]
                return await InputOrchestrator(client, TrustedInput(bridge, token), selection).handle(text)

            for template in ("带我看{}。", "打开{}。", "带我到{}那里。"):
                for name, suffix in CASES:
                    expected_id = f"cn.tang.artifact.{suffix}"
                    result = await speak(template.format(name))
                    assert result and result["kind"] == "action", (name, result)
                    assert result["receipt"]["status"] == "committed", (name, result)
                    context = await client.get("context")
                    artifact = context["focused_artifact"]
                    assert artifact["id"] == expected_id
                    intro = await speak("介绍这个文物")
                    assert intro["kind"] == "narration"
                    assert intro["narration"]["contentId"] == artifact["presentation"]["background_node_id"]
                    assert intro["narration"]["text"].strip()
                    assert intro["narration"]["version"] == "0.3.3"

            for query, suffix in [("寺院守门", "dvarapala"), ("寺园守门", "dvarapala"),
                                  ("佛象", "votive-stele"), ("铜钳", "kaiyuan-coin")]:
                result = await speak("带我看" + query)
                assert result["kind"] == "action"
                assert (await client.get("context"))["focused_artifact"]["id"] == f"cn.tang.artifact.{suffix}"

            selection = SpokenSelection()
            before = await client.state()
            ambiguous = await speak("带我看乐佣", selection)
            assert ambiguous["kind"] == "clarification"
            assert len(selection.items) == 2
            assert (await client.state())["revision"] == before["revision"]
            second_id = selection.items[1]["id"]
            chosen = await speak("第二个", selection)
            assert chosen["kind"] == "action"
            assert (await client.get("context"))["focused_artifact"]["id"] == second_id
            assert not selection.items

            await speak("带我看佛像")
            next_group = await speak("带我看下一组文物")
            assert next_group["receipt"]["action"] == "browse_gallery"
            assert next_group["receipt"]["status"] == "committed"
            assert (await client.state())["gallery_view"]["window_start"] == 4
            previous_group = await speak("上一组")
            assert previous_group["receipt"]["status"] == "committed"
            assert (await client.state())["gallery_view"]["window_start"] == 0
        finally:
            await server.close()

    asyncio.run(run())
