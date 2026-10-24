from __future__ import annotations

from museum_mcp.action_tools import ActionTools, TrustedInput, VoiceApplicationClient
from museum_mcp.application_client import GatewayError
from museum_mcp.intent_adapter import interpret


class InputOrchestrator:
    """Exactly one final STT from one newly opened upstream transport per grant."""

    def __init__(self, client: VoiceApplicationClient, scope: TrustedInput):
        self.client, self.scope = client, scope
        self.handled = False
        self.closed = False

    async def handle(self, text: str) -> dict | None:
        if self.closed or self.handled:
            return None
        self.handled = True
        intent = interpret(text)
        if intent is None:
            return None
        if intent.kind == "resume":
            return {"kind": "resume", "message": "从刚才被打断的同片段开头继续"}
        if intent.kind == "background":
            return {"kind": "narration", "narration": await self._narration(background=True)}
        target = None
        if intent.kind == "locate":
            results = await self.client.get(
                "search", {"q": intent.query, "kind": "artifact", "limit": "5"}
            )
            items = results.get("items", [])
            if len(items) != 1:
                return {"kind": "clarification", "message": "请说更具体的文物名称，我还没有移动"}
            target = items[0]["id"]
        result = await ActionTools(self.client, self.scope).act(intent.kind, target)
        if self.closed:
            return None
        result["kind"] = "action"
        if result["receipt"].get("status") == "committed" and intent.kind in {
            "enter_story",
            "next_segment",
        }:
            result["narration"] = await self._narration()
        return result

    async def _narration(self, *, background=False) -> dict:
        state = await self.client.state()
        context = await self.client.get("context")
        focused = context.get("focused_artifact") or {}
        node = context.get("story_node") or {}
        content_id = focused.get("id") if background else node.get("node_id")
        if not content_id:
            raise GatewayError("当前没有可朗读的固定正文")
        packs = state.get("pack_versions", {})
        pack_id = next((key for key in packs if content_id.startswith(key.rsplit(".", 1)[0])), None)
        if pack_id is None:
            pack_id = next(iter(packs), None)
        if not pack_id:
            raise GatewayError("当前会话没有固定内容版本")
        page = await self.client.get(
            "content",
            {
                "pack_id": pack_id,
                "version": packs[pack_id],
                "content_id": content_id,
                "limit": "1",
                "byte_budget": "4096",
            },
        )
        paragraphs = page.get("paragraphs") or []
        if not paragraphs:
            raise GatewayError("当前片段没有已准备正文")
        return {
            "packId": pack_id,
            "version": packs[pack_id],
            "contentId": paragraphs[0]["content_id"],
            "text": paragraphs[0]["text"],
        }

    async def close(self) -> None:
        self.closed = True
        await self.client.voice("cancel", scope=self.scope)
