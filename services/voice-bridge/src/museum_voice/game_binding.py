import secrets
from dataclasses import dataclass, field

from aiohttp import web
from museum_mcp.action_tools import VoiceApplicationClient
from museum_mcp.application_client import BoundSession, GatewayError


@dataclass
class GameBinding:
    binding_id: str
    client: VoiceApplicationClient
    bridge_token: str = field(repr=False)


GAME_BINDINGS = web.AppKey("game_bindings", dict)


async def bind_game(request: web.Request) -> web.Response:
    try:
        data = await request.json()
        binding = BoundSession(**data)
        client = VoiceApplicationClient(binding, origin=request.headers["Origin"])
        result = await client.voice("bind")
        identifier = secrets.token_urlsafe(24)
        request.app[GAME_BINDINGS].clear()
        request.app[GAME_BINDINGS][identifier] = GameBinding(
            identifier, client, result["bridge_token"]
        )
        return web.json_response({"binding_id": identifier, "status": "bound"})
    except (ValueError, TypeError, KeyError, GatewayError):
        raise web.HTTPBadRequest(text="当前展台语音绑定失败，请确认游戏版本与页面配对") from None
