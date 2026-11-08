from __future__ import annotations

import re
from dataclasses import dataclass, field

from museum_mcp.action_tools import ActionTools, TrustedInput, VoiceApplicationClient
from museum_mcp.application_client import GatewayError
from museum_mcp.intent_adapter import Intent, interpret, is_entry_request
from museum_mcp.locate_query import bare_locate_query
from museum_mcp.time_query import eras_from_pack_versions


@dataclass
class SpokenSelection:
    """Candidate choice survives microphone reconnects of the same game binding."""
    items: list[dict] = field(default_factory=list)
    purpose: str = "locate"

    def choose(self, text: str) -> str | None:
        if not self.items or re.search(r"为什么|什么|如何|是不是|是否|吗|故事", text):
            return None
        value = re.sub(r"[\s，。！？!?、,.]", "", text)
        ordinal = re.fullmatch(
            r"(?:那就|就)?(?:我选|我要看|我想看|带我看|看看|看|选|要)?第?"
            r"([一二三四五六七八九]?十[一二三四五六七八九]?|[一二三四五六七八九]|[1-9][0-9]?)(?:个|件)?", value
        )
        if ordinal:
            raw = ordinal[1]
            digits = "一二三四五六七八九"
            if raw.isdigit():
                number = int(raw)
            elif "十" in raw:
                tens, ones = raw.split("十")
                number = (digits.index(tens) + 1 if tens else 1) * 10 + (digits.index(ones) + 1 if ones else 0)
            else:
                number = digits.index(raw) + 1
            if 0 < number <= len(self.items):
                return self.items[number - 1]["title"]
            return None
        if re.search(r"看|找|参观|打开|定位", value):
            return None
        value = re.sub(r"^(?:我选|就选|选|那个|这个)", "", value).removesuffix("的")
        matched = [item for item in self.items if len(value) >= 2 and value in item["title"]]
        return matched[0]["title"] if len(matched) == 1 else value if matched else None


class InputOrchestrator:
    """Exactly one final STT from one newly opened upstream transport per grant."""

    def __init__(self, client: VoiceApplicationClient, scope: TrustedInput, selection: SpokenSelection | None = None):
        self.client, self.scope = client, scope
        self.handled = False
        self.closed = False
        self.intent_kind: str | None = None
        self.selection = selection if selection is not None else SpokenSelection()

    def owns_reply(self, text: str) -> bool:
        return (interpret(text) is not None or is_entry_request(text)
                or self.selection.choose(text) is not None or bare_locate_query(text) is not None)

    async def _pack_versions(self) -> dict[str, str] | None:
        try:
            state = await self.client.state()
        except GatewayError:
            return None
        packs = state.get("pack_versions")
        if not isinstance(packs, dict):
            return None
        return {key: value for key, value in packs.items() if isinstance(key, str) and isinstance(value, str)}

    async def handle(self, text: str) -> dict | None:
        if self.closed or self.handled:
            return None
        self.handled = True
        intent = interpret(text, pack_versions=await self._pack_versions())
        choice = self.selection.choose(text)
        if choice and (intent is None or intent.kind == "locate"):
            intent = Intent(self.selection.purpose, choice)
        if intent is None and not is_entry_request(text):
            bare = bare_locate_query(text)
            if bare:
                intent = Intent("locate", bare)
        if intent is None:
            return None
        self.intent_kind = intent.kind
        if intent.kind == "clarify_target":
            return {"kind": "clarification", "message": "请说出想看的展品名称，例如“牛”或“铜钱”，我再带你过去"}
        if intent.kind == "clarify_time":
            return {"kind": "clarification", "message": intent.message or "请说出完整的年份或年份范围"}
        if intent.kind == "unavailable_era":
            packs = await self._pack_versions()
            label = "宋朝" if eras_from_pack_versions(packs) == {"song"} else "唐朝"
            return {"kind": "clarification", "message": intent.message or f"当前只开放{label}文物，该朝代尚未开放"}
        if intent.kind == "resume":
            return {"kind": "resume", "message": "从刚才被打断的同片段开头继续"}
        if intent.kind == "background":
            return {"kind": "narration", "narration": await self._narration(background=True)}
        if intent.kind in {"story_current", "story_named", "story_consent", "story_decline"}:
            return await self._story_request(intent)
        target = None
        diagnosis: dict = {"intent": intent.kind, "query": intent.query}
        if intent.kind == "locate":
            results = await self.client.get(
                "search",
                {"q": intent.query, "kind": "artifact", "limit": "50", "mode": "spoken"},
            )
            items = results.get("items", [])
            diagnosis["candidates"] = len(items)
            diagnosis["candidate_ids"] = [
                item.get("id") for item in items if isinstance(item, dict) and isinstance(item.get("id"), str)
            ]
            diagnosis["candidate_titles"] = [
                item.get("title") if isinstance(item.get("title"), str) else item.get("id")
                for item in items
                if isinstance(item, dict) and isinstance(item.get("id"), str)
            ]
            if len(items) != 1:
                self.selection.items = [item for item in items if item.get("id") and item.get("title")]
                self.selection.purpose = "locate"
                diagnosis["status"] = "ambiguous" if items else "unresolved"
                names = "、".join(
                    title for title in diagnosis["candidate_titles"] if isinstance(title, str)
                )
                return {
                    "kind": "clarification",
                    "message": (
                        f"找到{len(items)}件：{names}。你想看哪件？可以说名称或“第二个”。"
                        if items
                        else "当前展厅没有这件文物"
                    ),
                    "diagnosis": diagnosis,
                }
            target = items[0]["id"]
            diagnosis["artifact_id"] = target
            diagnosis["canonical_title"] = items[0].get("title")
        result = await ActionTools(self.client, self.scope).act(
            intent.kind,
            target,
            start_year=intent.start_year,
            end_year=intent.end_year,
        )
        if self.closed:
            return None
        result["kind"] = "action"
        result["diagnosis"] = diagnosis
        receipt = result.get("receipt") or {}
        if receipt.get("status") == "committed" or result.get("presentation_action"):
            self.selection.items.clear()
        if receipt.get("status") == "committed" and intent.kind == "next_segment":
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
        if background:
            presentation = focused.get("presentation") or {}
            background_id = presentation.get("background_node_id")
            authorship = paragraph.get("authorship") or {}
            openable_stories = focused.get("story_entry_ids") or []
            authored_story = authorship.get("story_id")
            if (
                page.get("content_kind") != "background"
                or page.get("artifact_id") != focused.get("id")
                or not background_id
                or paragraph.get("content_id") != background_id
                or authorship.get("node_id") != background_id
                or not authored_story
                or (openable_stories and authored_story not in openable_stories)
            ):
                raise GatewayError("当前文物的背景节点或故事归属不一致，已取消本轮讲解")
        elif paragraph.get("content_id") != content_id:
            raise GatewayError("固定正文与当前故事段落不一致")
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

    async def _story_request(self, intent) -> dict:
        kind = {
            "story_current": "explicit_current",
            "story_named": "explicit_named",
            "story_consent": "consent",
            "story_decline": "decline",
        }[intent.kind]
        request = {"kind": kind, "query": intent.query}
        diagnosis = {"intent": intent.kind, "query": intent.query}
        if intent.kind == "story_named" and intent.query:
            results = await self.client.get(
                "search",
                {"q": intent.query, "kind": "artifact", "limit": "50", "mode": "spoken"},
            )
            items = results.get("items", [])
            diagnosis["candidates"] = len(items)
            request["candidates"] = len(items)
            if len(items) == 1:
                request["artifact_id"] = items[0]["id"]
                request["canonical_title"] = items[0].get("title")
                diagnosis["artifact_id"] = items[0]["id"]
                diagnosis["canonical_title"] = items[0].get("title")
                self.selection.items.clear()
            else:
                self.selection.items = [item for item in items if item.get("id") and item.get("title")]
                self.selection.purpose = "story_named"
                diagnosis["candidate_ids"] = [item["id"] for item in self.selection.items]
                diagnosis["candidate_titles"] = [item["title"] for item in self.selection.items]
                names = "、".join(diagnosis["candidate_titles"])
                return {"kind": "clarification", "diagnosis": diagnosis, "message": (
                    f"找到{len(items)}件：{names}。你想听哪件的故事？可以说名称或序号。"
                    if items else "当前展厅没有找到这件文物，请换一个名称。"
                )}
        return {
            "kind": "story_request",
            "story_request": request,
            "diagnosis": diagnosis,
            "message": {
                "explicit_current": "正在按当前文物打开故事",
                "explicit_named": "正在按指定文物打开故事",
                "consent": "正在确认故事邀请",
                "decline": "已记下先不讲故事",
            }.get(kind, "故事请求已转交展台"),
        }

    async def close(self) -> None:
        self.closed = True
        await self.client.voice("cancel", scope=self.scope)
