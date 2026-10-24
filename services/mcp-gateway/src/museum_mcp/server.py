from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from mcp.server.fastmcp import FastMCP

from museum_mcp.action_tools import ActionTools
from museum_mcp.application_client import ApplicationClient, BoundSession, GatewayError
from museum_mcp.tools import ReadTools


def create_server(tools: ReadTools, actions: ActionTools | None = None) -> FastMCP:
    server = FastMCP("时空博物馆")

    @server.tool()
    async def museum_get_context() -> dict:
        """查询当前唯一绑定展台正在看的文物和故事。它指当前焦点；查询不移动游戏。"""
        return await tools.context()

    @server.tool()
    async def museum_search(
        query: str, kind: str | None = None, cursor: str | None = None, limit: int = 5
    ) -> dict:
        """在当前会话内容包内按中文名称或别名找文物、事件、事实或故事，返回稳定ID。"""
        return await tools.search(query, kind, cursor, limit)

    @server.tool()
    async def museum_read_content(
        pack_id: str, version: str, content_id: str, cursor: str | None = None
    ) -> dict:
        """读取指定文物或故事的一段固定正文和资料出处；有next_cursor时可继续读。"""
        return await tools.read_content(pack_id, version, content_id, cursor)

    if actions is not None:

        @server.tool()
        async def museum_act(action: str, target_id: str | None = None) -> dict:
            """请求受限导航/观察/故事动作。只有可信本机输入作用域可执行，云端无来源时拒绝。"""
            return await actions.act(action, target_id)

    return server


def load_binding() -> BoundSession:
    path = os.environ.get("MUSEUM_MCP_BINDING_FILE")
    if not path:
        raise GatewayError("请先由当前展台提供本机私密绑定文件MUSEUM_MCP_BINDING_FILE")
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        return BoundSession(**data)
    except (OSError, TypeError, ValueError):
        raise GatewayError("本机展台绑定文件缺失或格式无效") from None


class CurrentBindingClient:
    """Read the current dedicated display binding per query, never an action grant."""

    async def get(self, route, params=None):
        return await ApplicationClient(load_binding()).get(route, params)


def main() -> None:
    if not os.environ.get("MUSEUM_MCP_BINDING_FILE"):
        print("请设置MUSEUM_MCP_BINDING_FILE，页面开启语音后自动登记当前展台", file=sys.stderr)
        raise SystemExit(2) from None
    create_server(ReadTools(CurrentBindingClient()), ActionTools()).run(transport="stdio")


if __name__ == "__main__":
    main()
