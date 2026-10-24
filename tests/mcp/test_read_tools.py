from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services/mcp-gateway/src"))

from museum_mcp.application_client import BoundSession, GatewayError
from museum_mcp.server import create_server
from museum_mcp.tools import ReadTools, bounded_result


class FakeClient:
    def __init__(self, data):
        self.data = data
        self.calls = []

    async def get(self, route, params=None):
        self.calls.append((route, params))
        return self.data


def test_context_resolves_current_focus_without_leaking_routing_credentials():
    client = FakeClient(
        {
            "session_id": "private-session",
            "connection_id": "private-connection",
            "session_token": "private-token",
            "revision": 7,
            "mode": "explore",
            "focused_artifact": {"id": "bull", "title": "鎏金卧牛", "asset_ids": ["model"]},
            "visible_artifacts": [{"id": "coin", "title": "开元通宝"}],
        }
    )
    result = asyncio.run(ReadTools(client).context())
    assert result["focused_artifact"]["id"] == "bull"
    assert result["revision"] == 7
    assert "private" not in json.dumps(result)
    assert "asset_ids" not in result["focused_artifact"]
    assert client.calls == [("context", None)]


def test_search_keeps_stable_ids_and_cursor_and_clamps_request_size():
    client = FakeClient({"items": [{"id": "coin", "title": "开元通宝"}], "next_cursor": "p2"})
    tools = ReadTools(client)
    assert asyncio.run(tools.search("铜钱", "artifact", "p1", 2))["next_cursor"] == "p2"
    assert client.calls[0][1] == {"q": "铜钱", "kind": "artifact", "cursor": "p1", "limit": "2"}
    for query, limit in [("", 1), ("牛", 0), ("牛", 11), ("牛" * 121, 1)]:
        with pytest.raises(GatewayError):
            asyncio.run(tools.search(query, limit=limit))


def test_read_keeps_authorship_and_sources_and_one_paragraph_budget():
    source = {"id": "museum", "title": "馆藏来源"}
    client = FakeClient(
        {
            "paragraphs": [
                {
                    "content_id": "node1",
                    "text": "这是预写正文。",
                    "authorship": {"fact_grade": "dramatized"},
                    "presentation": {"image": "large-asset"},
                }
            ],
            "related_facts": [{"id": "f1", "sources": [source]}],
            "next_cursor": "next",
        }
    )
    result = asyncio.run(ReadTools(client).read_content("cn.tang.core", "0.2.0", "bull"))
    assert result["paragraphs"][0]["authorship"]["fact_grade"] == "dramatized"
    assert "presentation" not in result["paragraphs"][0]
    assert result["related_facts"][0]["sources"] == [source]
    assert client.calls[0][1]["limit"] == "1"
    assert client.calls[0][1]["byte_budget"] == "4096"


def test_utf8_budget_is_bytes_and_does_not_truncate_json_or_sources():
    with pytest.raises(GatewayError, match="字节预算"):
        bounded_result({"text": "唐" * 50}, byte_budget=100)


@pytest.mark.parametrize(
    "url",
    [
        "https://example.org",
        "http://localhost:8780",
        "http://127.0.0.1:8780/api",
        "http://user:secret@127.0.0.1:8780",
        "http://127.0.0.1:8780?token=secret",
    ],
)
def test_binding_rejects_redirect_or_remote_destinations(url):
    with pytest.raises(ValueError):
        BoundSession(url, "session", "token", "connection")


def test_binding_repr_hides_credentials():
    binding = BoundSession(
        "http://127.0.0.1:8780", "session", "private-token", "private-connection"
    )
    assert "private" not in repr(binding)


def test_real_sdk_discovers_three_read_tools_and_schema_has_no_session_parameter():
    async def check():
        server = create_server(ReadTools(FakeClient({"mode": "explore"})))
        discovered = await server.list_tools()
        assert {item.name for item in discovered} == {
            "museum_get_context",
            "museum_search",
            "museum_read_content",
        }
        for item in discovered:
            assert "session" not in json.dumps(item.inputSchema)
        result = await server.call_tool("museum_get_context", {})
        assert result is not None

    asyncio.run(check())
