from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest
from aiohttp import ClientSession, web

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "services/voice-bridge/src"))

from museum_voice.config import DeviceConfig
from museum_voice.main import create_app, fixed_text_event, reject_redirect


def test_loopback_host_and_origin_protect_bridge_before_any_upstream_connection():
    async def run():
        config = DeviceConfig(
            "aa:bb:cc:dd:ee:ff",
            "4032ca38-fd23-4844-9f8a-e97035b0838c",
            "wss://api.xiaozhi.me/v1/",
            "test-token",
        )
        app = create_app(config, port=8781)
        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, "127.0.0.1", 0)
        await site.start()
        port = site._server.sockets[0].getsockname()[1]
        async with ClientSession() as client:
            async with client.get(
                f"http://127.0.0.1:{port}/health", headers={"Host": "evil.invalid"}
            ) as response:
                assert response.status == 403
            async with client.get(
                f"http://127.0.0.1:{port}/voice/ws",
                headers={"Host": "127.0.0.1:8781", "Origin": "http://evil.invalid"},
            ) as response:
                assert response.status == 403
            async with client.get(
                f"http://127.0.0.1:{port}/health", headers={"Host": "127.0.0.1:8781"}
            ) as response:
                result = await response.json()
                assert result["status"] == "ok"
                assert "token" not in str(result)
        await runner.cleanup()

    asyncio.run(run())


def test_redirect_callback_always_rejects_without_echoing_endpoint():
    async def run():
        try:
            await reject_redirect("wss://private-token")
        except ValueError as error:
            assert "private-token" not in str(error)
        else:
            raise AssertionError("redirect was accepted")

    asyncio.run(run())


def test_fixed_text_input_uses_normal_text_turn_and_never_carries_museum_authority():
    assert fixed_text_event("  请逐字朗读：唐代铜牛。  ", "cloud-session") == {
        "type": "listen",
        "state": "detect",
        "text": "请逐字朗读：唐代铜牛。",
        "session_id": "cloud-session",
    }
    with pytest.raises(ValueError):
        fixed_text_event("字" * 81, "cloud-session")
    with pytest.raises(ValueError):
        fixed_text_event("  ", "cloud-session")


@pytest.mark.parametrize("origin", ["http://127.0.0.1:5174", "http://127.0.0.1:5175", "http://127.0.0.1:5176"])
def test_unconfigured_bridge_status_is_explicit_and_contains_no_credentials(origin):
    async def run():
        app = create_app(None, port=8782, origin=origin)
        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, "127.0.0.1", 0)
        await site.start()
        port = site._server.sockets[0].getsockname()[1]
        try:
            async with (
                ClientSession() as client,
                client.get(
                    f"http://127.0.0.1:{port}/voice/status",
                    headers={
                        "Host": "127.0.0.1:8782",
                        "Origin": origin,
                    },
                ) as response,
            ):
                result = await response.json()
                assert result == {
                    "service": "museum-voice",
                    "status": "ok",
                    "device_configured": False,
                }
                assert (
                    response.headers["Access-Control-Allow-Origin"] == origin
                )
            async with ClientSession() as client, client.get(
                f"http://127.0.0.1:{port}/voice/status",
                headers={"Host": "127.0.0.1:8782", "Origin": "http://127.0.0.1:5999"},
            ) as denied:
                assert denied.status == 403
        finally:
            await runner.cleanup()

    asyncio.run(run())


def test_read_only_entry_hint_tells_preview_to_use_the_one_configured_origin():
    async def run():
        app = create_app(None, port=8782, origin="http://127.0.0.1:5190")
        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, "127.0.0.1", 0)
        await site.start()
        port = site._server.sockets[0].getsockname()[1]
        try:
            async with ClientSession() as client, client.get(
                f"http://127.0.0.1:{port}/voice/entry",
                headers={"Host": "127.0.0.1:8782", "Origin": "http://127.0.0.1:5191"},
            ) as response:
                assert response.status == 200
                assert response.headers["Access-Control-Allow-Origin"] == "*"
                assert await response.json() == {
                    "service": "museum-voice",
                    "web_origin": "http://127.0.0.1:5190",
                    "device_configured": False,
                }
            async with ClientSession() as client, client.post(
                f"http://127.0.0.1:{port}/voice/bind",
                headers={"Host": "127.0.0.1:8782", "Origin": "http://127.0.0.1:5191"},
                json={},
            ) as denied:
                assert denied.status == 403
        finally:
            await runner.cleanup()

    asyncio.run(run())
