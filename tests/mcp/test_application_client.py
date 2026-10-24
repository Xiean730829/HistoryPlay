from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest
from aiohttp import web

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "services/mcp-gateway/src"))

from museum_mcp.application_client import ApplicationClient, BoundSession, GatewayError


def run_http_case(handler, check):
    async def run():
        app = web.Application()
        app.router.add_get("/api/sessions/one/context", handler)
        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, "127.0.0.1", 0)
        await site.start()
        port = site._server.sockets[0].getsockname()[1]
        client = ApplicationClient(
            BoundSession(
                f"http://127.0.0.1:{port}",
                "one",
                "private-token",
                "private-binding",
            )
        )
        try:
            await check(client)
        finally:
            await runner.cleanup()

    asyncio.run(run())


def test_http_client_uses_bound_headers_and_read_only_method():
    async def handler(request):
        assert request.headers["Authorization"] == "Bearer private-token"
        assert request.headers["X-Museum-Connection"] == "private-binding"
        assert request.method == "GET"
        return web.json_response({"revision": 8})

    async def check(client):
        assert await client.get("context") == {"revision": 8}
        with pytest.raises(GatewayError):
            await client.get("commands")

    run_http_case(handler, check)


@pytest.mark.parametrize("status", [302, 401, 403, 500])
def test_http_errors_do_not_echo_private_body_or_follow_redirects(status):
    async def handler(request):
        return web.Response(
            status=status,
            text="private-token",
            headers={
                "Location": "http://example.org/private-token",
            },
        )

    async def check(client):
        with pytest.raises(GatewayError) as error:
            await client.get("context")
        assert "private-token" not in str(error.value)

    run_http_case(handler, check)


def test_http_oversized_response_is_rejected_before_json_parsing():
    async def handler(request):
        return web.Response(body=b"x" * (64 * 1024 + 1))

    async def check(client):
        with pytest.raises(GatewayError, match="过大"):
            await client.get("context")

    run_http_case(handler, check)
