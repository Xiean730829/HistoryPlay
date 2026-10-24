from __future__ import annotations

import asyncio
import json
import os
import sys

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


def test_real_stdio_initialize_and_discover_without_cloud_credentials(tmp_path):
    binding = tmp_path / "binding.json"
    binding.write_text(
        json.dumps(
            {
                "base_url": "http://127.0.0.1:1",
                "session_id": "test-session",
                "session_token": "test-token",
                "connection_id": "test-connection",
            }
        ),
        encoding="utf-8",
    )

    async def run():
        params = StdioServerParameters(
            command=sys.executable,
            args=["-m", "museum_mcp.server"],
            env={**os.environ, "MUSEUM_MCP_BINDING_FILE": str(binding)},
        )
        async with (
            stdio_client(params) as (read, write),
            ClientSession(read, write) as client,
        ):
            initialized = await client.initialize()
            assert initialized.serverInfo.name == "时空博物馆"
            tools = await client.list_tools()
            assert len(tools.tools) == 4
            result = await client.call_tool("museum_get_context", {})
            assert result.isError is True
            text = " ".join(item.text for item in result.content if item.type == "text")
            assert "无法连接本机游戏服务" in text
            assert "test-token" not in text

    asyncio.run(run())
