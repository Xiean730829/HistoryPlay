from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from aiohttp import web

from museum.adapters.http.helpers import require_binding, require_session
from museum.adapters.sqlite.receipt_repository import IdempotencyConflict
from museum.application.command_service import InvalidCommand, SessionNotFound
from museum.application.control_tickets import InvalidControlTicket


def register_command_routes(app: web.Application) -> None:
    app.router.add_post("/api/sessions/{session_id}/commands", execute_command)


async def execute_command(request: web.Request) -> web.Response:
    session_id = request.match_info["session_id"]
    configured = require_session(request, session_id, mutation=True)
    actor_id = require_binding(request, configured, session_id)
    try:
        payload = await request.json()
    except (ValueError, web.HTTPBadRequest) as error:
        raise web.HTTPBadRequest(text="命令请求体必须是JSON对象") from error
    if not isinstance(payload, Mapping):
        raise web.HTTPBadRequest(text="命令请求体必须是JSON对象")
    try:
        receipt = configured.commands.execute(session_id, actor_id, payload)
    except InvalidCommand as error:
        raise web.HTTPBadRequest(text=str(error)) from error
    except InvalidControlTicket as error:
        raise web.HTTPForbidden(text=str(error)) from error
    except IdempotencyConflict as error:
        raise web.HTTPConflict(text=str(error)) from error
    except SessionNotFound as error:
        raise web.HTTPNotFound(text=str(error)) from error
    body: dict[str, Any] = receipt.to_dict()
    return web.json_response(body, status=409 if receipt.status == "rejected" else 200)
