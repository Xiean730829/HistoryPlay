from __future__ import annotations

import json
from typing import Any, Protocol

from museum_mcp.application_client import GatewayError


class ReadClient(Protocol):
    async def get(self, route: str, params: dict[str, Any] | None = None) -> dict[str, Any]: ...


def bounded_result(data: dict[str, Any], byte_budget: int = 12288) -> dict[str, Any]:
    if len(json.dumps(data, ensure_ascii=False).encode("utf-8")) > byte_budget:
        raise GatewayError("工具响应超过字节预算，请使用更小的页长继续查询")
    return data


class ReadTools:
    def __init__(self, client: ReadClient) -> None:
        self.client = client

    async def context(self) -> dict[str, Any]:
        data = await self.client.get("context")
        # Never disclose local routing handles, tokens, or irrelevant render resources.
        focused = data.get("focused_artifact")

        def brief(artifact: Any) -> dict[str, Any] | None:
            if not isinstance(artifact, dict):
                return None
            return {
                key: artifact.get(key)
                for key in (
                    "id",
                    "title",
                    "museum",
                    "time_range",
                    "material",
                    "category",
                    "fact_card_ids",
                    "story_entry_ids",
                )
            }

        node = data.get("story_node")
        return bounded_result(
            {
                "mode": data.get("mode"),
                "revision": data.get("revision"),
                "focused_artifact": brief(focused),
                "visible_artifacts": [brief(item) for item in data.get("visible_artifacts", [])],
                "story_node": (
                    {
                        key: node.get(key)
                        for key in (
                            "story_id",
                            "node_id",
                            "fact_grade",
                            "allowed_actions",
                        )
                    }
                    if isinstance(node, dict)
                    else None
                ),
                "guidance": "它、这个文物指focused_artifact；没有焦点时先搜索，不自行猜测。",
            }
        )

    async def search(
        self, query: str, kind: str | None = None, cursor: str | None = None, limit: int = 5
    ) -> dict[str, Any]:
        if not query.strip() or len(query) > 120 or not 1 <= limit <= 10:
            raise GatewayError("搜索词须为1到120字，页长须为1到10")
        if kind not in (None, "artifact", "event", "fact", "story"):
            raise GatewayError("不支持的内容类型")
        params: dict[str, Any] = {"q": query, "limit": str(limit)}
        if kind is not None:
            params["kind"] = kind
        if cursor:
            params["cursor"] = cursor
        return bounded_result(await self.client.get("search", params))

    async def read_content(
        self, pack_id: str, version: str, content_id: str, cursor: str | None = None
    ) -> dict[str, Any]:
        if not all(value and len(value) <= 256 for value in (pack_id, version, content_id)):
            raise GatewayError("正文查询需要有效的内容包、版本和内容ID")
        params = {
            "pack_id": pack_id,
            "version": version,
            "content_id": content_id,
            "limit": "1",
            "byte_budget": "4096",
        }
        if cursor:
            params["cursor"] = cursor
        data = await self.client.get("content", params)
        # Keep authored text and provenance; omit image/model payloads from tool context.
        paragraphs = [
            {
                key: item.get(key)
                for key in (
                    "content_id",
                    "version",
                    "paragraph_number",
                    "text",
                    "authorship",
                    "allowed_actions",
                )
            }
            for item in data.get("paragraphs", [])
        ]
        return bounded_result(
            {
                **{
                    key: data.get(key)
                    for key in (
                        "content_id",
                        "content_kind",
                        "pack_id",
                        "version",
                        "title",
                        "artifact_id",
                        "related_facts",
                        "next_cursor",
                        "text_bytes",
                    )
                },
                "paragraphs": paragraphs,
                "guidance": "按authorship区分史实和创作；保留来源。这里只取正文，不表示已朗读。",
            },
            byte_budget=16384,
        )
