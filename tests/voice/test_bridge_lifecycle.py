from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

from aiohttp import ClientSession, WSMessage, WSMsgType, web

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "services/voice-bridge/src"))
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "services/mcp-gateway/src"))

import museum_voice.main as voice_main
from museum_mcp.application_client import BoundSession
from museum_voice.config import DeviceConfig
from museum_voice.game_binding import GAME_BINDINGS, GameBinding


class FakeUpstream:
    def __init__(self):
        self.sent: list[dict] = []
        self.messages: asyncio.Queue = asyncio.Queue()
        self.closed = False

    async def send_json(self, value):
        self.sent.append(value)

    async def receive_json(self):
        return {"type": "hello", "transport": "websocket", "session_id": "test-session"}

    def __aiter__(self):
        return self

    async def __anext__(self):
        message = await self.messages.get()
        if message is None:
            raise StopAsyncIteration
        return message

    async def push_json(self, value):
        await self.messages.put(WSMessage(WSMsgType.TEXT, json.dumps(value), None))

    async def close(self):
        if not self.closed:
            self.closed = True
            await self.messages.put(None)


class FakeUpstreamSession:
    def __init__(self, upstream):
        self.upstream = upstream

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        await self.upstream.close()

    async def ws_connect(self, *_args, **_kwargs):
        return self.upstream


class FakeApplicationClient:
    binding = BoundSession("http://127.0.0.1:8793", "test-session", "test-token", "test-connection")

    async def get(self, route):
        return {"revision": 1, "focused_artifact": {"id": "coin"}, "story_node": None}

    async def voice(self, operation, **_kwargs):
        if operation == "begin":
            return {"input_token": "test-input-token"}
        return {"status": "ok"}


def test_browser_websocket_stays_open_after_ready_and_forwards_text(monkeypatch, tmp_path):
    async def run():
        upstream = FakeUpstream()
        monkeypatch.setattr(
            voice_main,
            "ClientSession",
            lambda **_kwargs: FakeUpstreamSession(upstream),
        )
        config = DeviceConfig(
            "aa:bb:cc:dd:ee:ff",
            "4032ca38-fd23-4844-9f8a-e97035b0838c",
            "wss://api.xiaozhi.me/v1/",
            "test-token",
        )
        app = voice_main.create_app(
            config,
            port=8784,
            origin="http://127.0.0.1:5190",
            web_origins=("http://127.0.0.1:5190",),
            binding_file=tmp_path / "binding.json",
        )
        binding_id = "test-binding"
        app[GAME_BINDINGS][binding_id] = GameBinding(
            binding_id, FakeApplicationClient(), "test-bridge-token"
        )
        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, "127.0.0.1", 0)
        await site.start()
        port = site._server.sockets[0].getsockname()[1]
        try:
            async with ClientSession() as browser_client:
                ws = await browser_client.ws_connect(
                    f"http://127.0.0.1:{port}/voice/ws",
                    headers={
                        "Host": "127.0.0.1:8784",
                        "Origin": "http://127.0.0.1:5190",
                    },
                )
                await ws.send_json({"op": "bind", "binding_id": binding_id})
                ready = await asyncio.wait_for(ws.receive_json(), timeout=2)
                assert ready == {"type": "ready", "sample_rate": 24000}
                assert not ws.closed

                await ws.send_json({"op": "text", "text": "请逐字朗读：入口讲解正文", "request_id": "cue-fixture-1"})
                for _ in range(50):
                    if any(item.get("state") == "detect" for item in upstream.sent):
                        break
                    await asyncio.sleep(0.01)
                assert any(
                    item.get("state") == "detect" and item.get("text") == "读取当前讲稿"
                    for item in upstream.sent
                )
                assert not ws.closed
                staged = await asyncio.wait_for(ws.receive_json(), timeout=2)
                assert staged == {"type": "narration_ack", "request_id": "cue-fixture-1", "stage": "staged"}
                private_cue = json.loads((tmp_path / "narration-cue.json").read_text(encoding="utf-8"))
                assert private_cue["text"] == "入口讲解正文"
                await upstream.push_json({"type": "tts", "state": "start"})
                reply = await asyncio.wait_for(ws.receive_json(), timeout=2)
                assert reply == {"type": "tts", "state": "start"}
                await upstream.push_json({"type": "tts", "state": "sentence_start", "text": "% museum_read_narration..."})
                progress = await asyncio.wait_for(ws.receive_json(), timeout=2)
                assert progress["type"] == "narration_ack" and progress["stage"] == "fetching"
                await upstream.push_json({
                    "type": "tts", "state": "sentence_start", "text": "入口讲解正文"
                })
                narration = await asyncio.wait_for(ws.receive_json(), timeout=2)
                assert narration == {
                    "type": "tts", "state": "sentence_start", "text": "入口讲解正文"
                }
                await upstream.push_json({"type": "tts", "state": "stop"})
                stopped = await asyncio.wait_for(ws.receive_json(), timeout=2)
                assert stopped == {"type": "tts", "state": "stop"}
                assert not ws.closed
                await ws.close()
        finally:
            await runner.cleanup()

    asyncio.run(run())
