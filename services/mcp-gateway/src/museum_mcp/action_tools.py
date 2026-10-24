from __future__ import annotations

import json
from dataclasses import dataclass, field
from urllib.parse import quote

import aiohttp

from museum_mcp.application_client import ApplicationClient, GatewayError


@dataclass(frozen=True)
class TrustedInput:
    bridge_token: str = field(repr=False)
    input_token: str = field(repr=False)


class VoiceApplicationClient(ApplicationClient):
    def __init__(self, binding, *, origin="http://127.0.0.1:5174"):
        super().__init__(binding)
        self.origin = origin

    async def state(self) -> dict:
        return await self._request("GET", "", None)

    async def voice(
        self,
        operation: str,
        data=None,
        scope: TrustedInput | None = None,
        bridge_token: str | None = None,
    ) -> dict:
        if operation not in {"bind", "begin", "cancel", "act", "view"}:
            raise GatewayError("不支持的语音生命周期操作")
        headers = {}
        if scope:
            headers["X-Museum-Voice-Bridge"] = scope.bridge_token
            headers["X-Museum-Voice-Input"] = scope.input_token
        elif bridge_token:
            headers["X-Museum-Voice-Bridge"] = bridge_token
        return await self._request("POST", f"/voice/{operation}", data or {}, headers)

    async def _request(self, method, suffix, data, extra=None):
        binding = self.binding
        url = f"{binding.base_url.rstrip('/')}/api/sessions/{quote(binding.session_id, safe='')}{suffix}"
        headers = {
            "Authorization": f"Bearer {binding.session_token}",
            "X-Museum-Connection": binding.connection_id,
            "Origin": self.origin,
            **(extra or {}),
        }
        try:
            async with (
                aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=8)) as client,
                client.request(
                    method, url, json=data, headers=headers, allow_redirects=False
                ) as response,
            ):
                if response.status not in (200, 201, 409):
                    raise GatewayError(f"游戏语音请求失败（HTTP {response.status}）")
                body = bytearray()
                async for chunk in response.content.iter_chunked(4096):
                    body.extend(chunk)
                    if len(body) > 65536:
                        raise GatewayError("游戏语音响应超过预算")
                result = json.loads(body)
                if not isinstance(result, dict):
                    raise GatewayError("游戏语音响应格式无效")
                return result
        except (aiohttp.ClientError, TimeoutError, ValueError):
            raise GatewayError("游戏语音服务暂不可用") from None


class ActionTools:
    """The same bounded action implementation for MCP and local trusted orchestration."""

    def __init__(
        self, client: VoiceApplicationClient | None = None, scope: TrustedInput | None = None
    ):
        self.client, self.scope = client, scope

    async def act(self, action: str, target_id: str | None = None) -> dict:
        if self.scope is None or self.client is None:
            raise GatewayError("该云端调用没有可信输入来源，保持只读；请通过已绑定网页语音输入")
        context = await self.client.get("context")
        focused = context.get("focused_artifact") or {}
        body: dict = {}
        if action in {"next", "previous"}:
            body["action"] = "move_next" if action == "next" else "move_previous"
        elif action == "locate" and target_id:
            body = {"action": "locate_artifact", "target_id": target_id}
        elif action in {"back", "front", "zoom_in", "zoom_out"}:
            applied = await self.client.voice("view", scope=self.scope)
            if applied.get("status") != "rendered":
                raise GatewayError("当前模型尚未完整呈现，请等展品显示后再调整角度")
            camera = dict(applied["camera"])
            if action == "back":
                camera["yaw"] = (camera["yaw"] + 360) % 360 - 180
            elif action == "front":
                camera = {"yaw": 0, "pitch": 0, "zoom": 1}
            else:
                camera["zoom"] = min(
                    8, max(0.25, camera["zoom"] * (1.4 if action == "zoom_in" else 1 / 1.4))
                )
            body = {"action": "set_view", "params": {"camera": camera}}
        elif action == "enter_story":
            stories = focused.get("story_entry_ids") or []
            if not stories:
                raise GatewayError("当前文物还没有开放故事")
            body = {"action": "enter_story", "target_id": stories[0]}
        elif action == "return":
            body = {"action": "return_to_exhibit"}
        elif action == "next_segment":
            body = {"action": "continue_story"}
        else:
            raise GatewayError("不支持的受限动作")
        receipt = await self.client.voice("act", body, self.scope)
        return {
            "receipt": receipt,
            "render_status": "pending",
            "message": "动作已提交，等待画面回执"
            if receipt.get("status") == "committed"
            else "当前动作未执行，位置保持不变",
        }
