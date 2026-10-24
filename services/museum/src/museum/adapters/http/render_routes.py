from __future__ import annotations

from collections.abc import Mapping

from aiohttp import web

from museum.adapters.http.helpers import load_state, require_binding, require_session
from museum.adapters.sqlite.receipt_repository import IdempotencyConflict
from museum.application.render_service import InvalidRenderReceipt, StaleRenderReceipt


def register_render_routes(app: web.Application) -> None:
    app.router.add_post("/api/sessions/{session_id}/render-receipts", report_render)


async def report_render(request: web.Request) -> web.Response:
    session_id = request.match_info["session_id"]
    configured = require_session(request, session_id, mutation=True)
    connection_id = require_binding(request, configured, session_id)
    try:
        body = await request.json()
    except (ValueError, web.HTTPBadRequest) as error:
        raise web.HTTPBadRequest(text="呈现回执必须是JSON对象") from error
    if not isinstance(body, Mapping):
        raise web.HTTPBadRequest(text="呈现回执必须是JSON对象")
    allowed = {
        "request_id",
        "payload_digest",
        "revision",
        "view_revision",
        "interaction_epoch",
        "status",
        "reason",
    }
    if set(body) - allowed or not allowed - {"reason"} <= set(body):
        raise web.HTTPBadRequest(text="呈现回执字段不符合协议")
    if any(
        not isinstance(body.get(key), str) for key in ("request_id", "payload_digest", "status")
    ):
        raise web.HTTPBadRequest(text="呈现回执标识和状态必须是字符串")
    if any(
        type(body.get(key)) is not int or body[key] < 0
        for key in ("revision", "view_revision", "interaction_epoch")
    ):
        raise web.HTTPBadRequest(text="呈现回执修订号必须是非负整数")

    with configured.database.read() as unit:
        try:
            command_receipt = unit.receipts.get(
                session_id, body["request_id"], body["payload_digest"]
            )
        except IdempotencyConflict as error:
            raise web.HTTPConflict(text=str(error)) from error
    if command_receipt is None or command_receipt.get("status") != "committed":
        raise web.HTTPConflict(text="只能确认已经提交的命令")
    if any(
        command_receipt.get(key) != body[key]
        for key in ("revision", "view_revision", "interaction_epoch")
    ):
        raise web.HTTPConflict(text="呈现回执与已提交命令版本不一致")

    state = load_state(configured, session_id)
    try:
        receipt = configured.renders.report(
            state=state,
            connection_id=connection_id,
            request_id=body["request_id"],
            revision=body["revision"],
            view_revision=body["view_revision"],
            interaction_epoch=body["interaction_epoch"],
            status=body["status"],
            reason=body.get("reason"),
        )
    except StaleRenderReceipt as error:
        raise web.HTTPConflict(text=str(error)) from error
    except InvalidRenderReceipt as error:
        raise web.HTTPBadRequest(text=str(error)) from error
    return web.json_response(receipt.to_dict(command_receipt))
