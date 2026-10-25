import asyncio
import json
import secrets
from collections.abc import Awaitable, Callable
from dataclasses import asdict, dataclass, field
from pathlib import Path

from aiohttp import web
from museum_mcp.action_tools import VoiceApplicationClient
from museum_mcp.application_client import BoundSession, GatewayError


@dataclass
class GameBinding:
    binding_id: str
    client: VoiceApplicationClient
    bridge_token: str = field(repr=False)
    cancel_input: Callable[[], Awaitable[None]] | None = field(default=None, repr=False)


GAME_BINDINGS = web.AppKey("game_bindings", dict)
BINDING_FILE = web.AppKey("mcp_binding_file", Path)
ACTIVE_AUDIO = web.AppKey("active_audio", set)


async def bind_game(request: web.Request) -> web.Response:
    try:
        data = await request.json()
        binding = BoundSession(**data)
        client = VoiceApplicationClient(binding, origin=request.headers["Origin"])
        result = await client.voice("bind")
        # A new display must retire the old display's input, including a different session.
        for previous in tuple(request.app[GAME_BINDINGS].values()):
            if previous.cancel_input is not None:
                try:
                    await previous.cancel_input()
                except GatewayError:
                    if previous.client.binding.session_id != binding.session_id:
                        raise
        for websocket in tuple(request.app[ACTIVE_AUDIO]):
            try:
                await asyncio.wait_for(websocket.close(), 2)
            except TimeoutError:
                pass
        path = request.app.get(BINDING_FILE)
        if path is not None:
            path.parent.mkdir(parents=True, exist_ok=True)
            temporary = path.with_suffix(path.suffix + ".tmp")
            temporary.write_text(json.dumps(asdict(binding)), encoding="utf-8")
            temporary.replace(path)
        identifier = secrets.token_urlsafe(24)
        request.app[GAME_BINDINGS].clear()
        request.app[GAME_BINDINGS][identifier] = GameBinding(
            identifier, client, result["bridge_token"]
        )
        return web.json_response({"binding_id": identifier, "status": "bound"})
    except (OSError, ValueError, TypeError, KeyError, GatewayError):
        raise web.HTTPBadRequest(text="当前展台语音绑定失败，请确认游戏版本与页面配对") from None
