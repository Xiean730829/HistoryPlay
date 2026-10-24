from __future__ import annotations

import asyncio
from dataclasses import asdict

from aiohttp import WSMsgType, web

from museum.adapters.http.auth import OriginRejected, require_allowed_origin
from museum.adapters.http.helpers import (
    load_state,
    require_binding,
    require_session,
    state_projection,
)


def register_event_routes(app: web.Application) -> None:
    app.router.add_get("/api/sessions/{session_id}/events", event_stream)


async def event_stream(request: web.Request) -> web.WebSocketResponse:
    session_id = request.match_info["session_id"]
    configured = require_session(request, session_id)
    try:
        require_allowed_origin(request.headers.get("Origin"), configured.allowed_origins)
    except OriginRejected as error:
        raise web.HTTPForbidden(text=str(error)) from error
    require_binding(request, configured, session_id)
    raw_cursor = request.query.get("after_seq")
    try:
        cursor = None if raw_cursor is None else int(raw_cursor)
        if cursor is not None and cursor < 0:
            raise ValueError
    except ValueError as error:
        raise web.HTTPBadRequest(text="after_seq必须是非负整数") from error

    socket = web.WebSocketResponse(heartbeat=30, max_msg_size=4096)
    await socket.prepare(request)
    queue = configured.event_hub.subscribe(session_id)
    try:
        state = load_state(configured, session_id)
        if cursor is None or cursor > state.event_seq:
            await _send_snapshot(socket, state)
            cursor = state.event_seq
        else:
            cursor = await _send_replay(socket, configured, session_id, cursor, state.event_seq)

        sender = asyncio.create_task(_send_updates(socket, configured, session_id, queue, cursor))
        try:
            async for message in socket:
                if message.type in {WSMsgType.CLOSE, WSMsgType.CLOSED, WSMsgType.ERROR}:
                    break
                if message.type == WSMsgType.TEXT:
                    await socket.close(code=1008, message=b"event stream is server-push only")
                    break
        finally:
            sender.cancel()
            await asyncio.gather(sender, return_exceptions=True)
    finally:
        configured.event_hub.unsubscribe(session_id, queue)
    return socket


async def _send_updates(socket, configured, session_id, queue, cursor: int) -> None:
    while not socket.closed:
        await queue.get()
        state = load_state(configured, session_id)
        cursor = await _send_replay(socket, configured, session_id, cursor, state.event_seq)


async def _send_replay(socket, configured, session_id, cursor: int, target_seq: int) -> int:
    while cursor < target_seq:
        with configured.database.read() as unit:
            events = unit.events.replay(session_id, after_seq=cursor, limit=500)
        if not events or events[0].event_seq != cursor + 1:
            state = load_state(configured, session_id)
            await _send_snapshot(socket, state)
            return state.event_seq
        for event in events:
            if event.event_seq != cursor + 1:
                state = load_state(configured, session_id)
                await _send_snapshot(socket, state)
                return state.event_seq
            await socket.send_json({"type": "event", "event": _event_projection(event)})
            cursor = event.event_seq
            if cursor >= target_seq:
                break
    return cursor


async def _send_snapshot(socket, state) -> None:
    await socket.send_json(
        {"type": "snapshot", "event_seq": state.event_seq, "state": state_projection(state)}
    )


def _event_projection(event) -> dict[str, object]:
    result = asdict(event)
    result["kind"] = event.kind.value
    return result
