import asyncio
import json

import pytest
from museum_mcp import server
from museum_mcp.application_client import GatewayError


def test_current_read_binding_updates_without_renewing_any_control_scope(tmp_path, monkeypatch):
    path = tmp_path / "private-binding.json"
    monkeypatch.setenv("MUSEUM_MCP_BINDING_FILE", str(path))
    seen = []

    class Client:
        def __init__(self, binding):
            self.binding = binding

        async def get(self, route, params=None):
            seen.append(self.binding.connection_id)
            return {"mode": "explore"}

    monkeypatch.setattr(server, "ApplicationClient", Client)
    client = server.CurrentBindingClient()
    with pytest.raises(GatewayError):
        asyncio.run(client.get("context"))
    for actor in ("page-one", "page-two"):
        path.write_text(
            json.dumps(
                {
                    "base_url": "http://127.0.0.1:8781",
                    "session_id": "session",
                    "session_token": "private-token",
                    "connection_id": actor,
                }
            ),
            encoding="utf-8",
        )
        asyncio.run(client.get("context"))
    assert seen == ["page-one", "page-two"]
