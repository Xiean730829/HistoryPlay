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
        context = await self.client.get("context")
        if self.closed:
            raise GatewayError("当前语音轮次已结束")
        focused = context.get("focused_artifact") or {}
        node = context.get("story_node") or {}
        content_id = focused.get("id") if background else node.get("node_id")
        if not content_id:
            raise GatewayError("当前没有可朗读的固定正文")
        state = await self.client.state()
        if self.closed:
            raise GatewayError("当前语音轮次已结束")
        packs = state.get("pack_versions", {})
        if not isinstance(packs, dict) or any(not isinstance(value, str) for value in packs.values()):
            raise GatewayError("当前会话没有有效的固定内容版本")
        pack_id = next((key for key in sorted(packs, key=len, reverse=True) if content_id.startswith(key)), None)
        if pack_id is None and len(packs) == 1:
            pack_id = next(iter(packs), None)
        if not pack_id:
            raise GatewayError("无法从当前内容身份确定唯一固定内容版本")
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
        if not paragraphs or not isinstance(paragraphs[0], dict):
            raise GatewayError("当前片段没有已准备正文")
        paragraph = paragraphs[0]
        if paragraph.get("content_id") not in (None, content_id):
            raise GatewayError("固定正文与当前文物或故事段落不一致")
        if background and page.get("artifact_id") not in (None, focused.get("id")):
            raise GatewayError("讲解正文属于另一件文物，已取消本轮讲解")
        if not background and page.get("story_id") not in (None, node.get("story_id")):
            raise GatewayError("故事正文属于另一条故事线，已取消本轮讲解")
        if not isinstance(paragraph.get("text"), str) or not paragraph["text"].strip():
            raise GatewayError("当前片段没有有效的固定正文")
        current = await self.client.get("context")
        if self.closed:
            raise GatewayError("当前语音轮次已结束")
        current_node = current.get("story_node") or {}
        current_focus = current.get("focused_artifact") or {}
        if (
            current.get("revision") != context.get("revision")
            or current_focus.get("id") != focused.get("id")
            or current_node.get("node_id") != node.get("node_id")
        ):
            raise GatewayError("讲解准备期间展台已变化，已取消旧文物讲解")
        return {
            "packId": pack_id,
            "version": packs[pack_id],
            "contentId": paragraph["content_id"],
            "text": paragraph["text"],
        }

    async def close(self) -> None:
        self.closed = True
        await self.client.voice("cancel", scope=self.scope)
