import json
import secrets
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


GAME_BINDINGS = web.AppKey("game_bindings", dict)
BINDING_FILE = web.AppKey("mcp_binding_file", Path)


async def bind_game(request: web.Request) -> web.Response:
    try:
        data = await request.json()
        binding = BoundSession(**data)
        client = VoiceApplicationClient(binding, origin=request.headers["Origin"])
        result = await client.voice("bind")
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
