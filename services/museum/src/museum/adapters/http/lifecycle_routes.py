from aiohttp import web

from museum.adapters.http.helpers import load_state, require_binding, require_session
from museum.application.voice_lifecycle import VoiceLifecycle

LIFECYCLE = web.AppKey("voice_lifecycle", VoiceLifecycle)


def register_voice_lifecycle_routes(app: web.Application, lifecycle: VoiceLifecycle) -> None:
    app[LIFECYCLE] = lifecycle
    app.router.add_post("/api/sessions/{session_id}/voice/{operation}", voice_operation)


async def voice_operation(request: web.Request) -> web.Response:
    session_id = request.match_info["session_id"]
    configured = require_session(request, session_id, mutation=True)
    actor = require_binding(request, configured, session_id)
    lifecycle = request.app[LIFECYCLE]
    operation = request.match_info["operation"]
    try:
        body = await request.json()
        if not isinstance(body, dict):
            raise TypeError("语音请求必须是对象")
        if operation == "bind":
            return web.json_response(
                {"bridge_token": lifecycle.bind(session_id, actor)},
                headers={"Cache-Control": "no-store"},
            )
        if operation == "view":
            latest_reader = getattr(configured.renders, "latest", None)
            latest = latest_reader(session_id, actor) if callable(latest_reader) else None
            state = load_state(configured, session_id)
            if latest is None or (
                latest.revision,
                latest.view_revision,
                latest.interaction_epoch,
            ) != (state.revision, state.view_revision, state.interaction_epoch):
                return web.json_response({"status": "pending"})
            return web.json_response(
                {
                    "status": latest.status,
                    "view_revision": state.view_revision,
                    "camera": {
                        "yaw": state.camera_pose.yaw,
                        "pitch": state.camera_pose.pitch,
                        "zoom": state.camera_pose.zoom,
                    },
                }
            )
        bridge_token = request.headers.get("X-Museum-Voice-Bridge", "")
        if operation == "begin":
            return web.json_response(
                {"input_token": lifecycle.begin(session_id, actor, bridge_token)},
                headers={"Cache-Control": "no-store"},
            )
        input_token = request.headers.get("X-Museum-Voice-Input", "")
        if operation == "cancel":
            lifecycle.cancel(session_id, actor, bridge_token, input_token)
            return web.json_response({"status": "cancelled"})
        if operation == "act":
            if set(body) - {"action", "target_id", "params"}:
                raise ValueError("模型不得传入版本、票据或输入身份")
            result = lifecycle.execute(
                session_id,
                actor,
                bridge_token,
                input_token,
                body.get("action", ""),
                target_id=body.get("target_id"),
                params=body.get("params"),
            )
            if result["status"] == "committed":
                configured.event_hub.publish(session_id)
            return web.json_response(result, status=409 if result["status"] == "rejected" else 200)
        raise web.HTTPNotFound()
    except PermissionError as error:
        raise web.HTTPForbidden(text=str(error)) from error
    except (ValueError, TypeError) as error:
        raise web.HTTPBadRequest(text=str(error)) from error
