from __future__ import annotations

from typing import Any

from aiohttp import web

from museum.adapters.http.auth import (
    AuthenticationError,
    OriginRejected,
    require_allowed_origin,
)
from museum.adapters.http.services import HttpServices
from museum.application.binding_service import InvalidBinding
from museum.domain.session.models import SessionState

SERVICES_KEY: web.AppKey[HttpServices] = web.AppKey("museum_services", HttpServices)


def services(request: web.Request) -> HttpServices:
    return request.app[SERVICES_KEY]


def require_session(
    request: web.Request, session_id: str, *, mutation: bool = False
) -> HttpServices:
    configured = services(request)
    try:
        if mutation:
            require_allowed_origin(request.headers.get("Origin"), configured.allowed_origins)
        configured.authenticator.authenticate(request.headers.get("Authorization"), session_id)
    except OriginRejected as error:
        raise web.HTTPForbidden(text=str(error)) from error
    except AuthenticationError as error:
        raise web.HTTPUnauthorized(text=str(error)) from error
    return configured


def require_binding(request: web.Request, configured: HttpServices, session_id: str) -> str:
    try:
        return configured.bindings.require_active(
            session_id, request.headers.get("X-Museum-Connection")
        )
    except InvalidBinding as error:
        raise web.HTTPForbidden(text=str(error)) from error


def load_state(configured: HttpServices, session_id: str) -> SessionState:
    with configured.database.read() as unit:
        state = unit.sessions.get(session_id)
    if state is None:
        raise web.HTTPNotFound(text="会话不存在")
    return state


def state_projection(state: SessionState) -> dict[str, Any]:
    result: dict[str, Any] = {
        "schema_version": "1",
        "session_id": state.session_id,
        "pack_versions": dict(state.pack_versions),
        "mode": state.mode.value,
        "visible_entities": list(state.visible_entities),
        "display_order": list(state.display_order),
        "story_variables": dict(state.story_variables),
        "return_stack": [_return_point(point) for point in state.return_stack],
        "revision": state.revision,
        "view_revision": state.view_revision,
        "event_seq": state.event_seq,
        "interaction_epoch": state.interaction_epoch,
        "discoveries": sorted(state.discoveries),
        "camera_pose": _camera(state.camera_pose),
    }
    if state.world_time is not None:
        result["world_time"] = _world_time(state)
    if state.gallery_id is not None:
        result["gallery_id"] = state.gallery_id
    if state.station_id is not None:
        result["station_id"] = state.station_id
    if state.current_location_id is not None:
        result["current_location_id"] = state.current_location_id
    if state.focused_entity_id is not None:
        result["focused_entity_id"] = state.focused_entity_id
    if state.story_id is not None:
        result["story_id"] = state.story_id
    if state.node_id is not None:
        result["node_id"] = state.node_id
    if state.narration_checkpoint is not None:
        result["narration_checkpoint"] = _checkpoint(state.narration_checkpoint)
    if state.exhibit_return_point is not None:
        point = state.exhibit_return_point
        result["exhibit_return_point"] = {
            "gallery_id": point.gallery_id,
            "station_id": point.station_id,
            "view": _camera(point.view),
            "view_revision": point.view_revision,
            **({"focused_entity_id": point.focused_entity_id} if point.focused_entity_id else {}),
        }
    return result


def context_projection(context: Any) -> dict[str, Any]:
    return {
        "session_id": context.session_id,
        "revision": context.revision,
        "event_seq": context.event_seq,
        "mode": context.mode,
        "focused_artifact": _artifact(context.focused_artifact),
        "visible_artifacts": [_artifact(item) for item in context.visible_artifacts],
        "story_node": (
            {
                "story_id": context.story_node.story_id,
                "node_id": context.story_node.node_id,
                "narration": context.story_node.narration,
                "fact_grade": context.story_node.fact_grade,
                "presentation": context.story_node.presentation,
                "allowed_actions": list(context.story_node.allowed_actions),
            }
            if context.story_node
            else None
        ),
    }


def gallery_projection(gallery: Any) -> dict[str, Any]:
    return {
        "id": gallery.id,
        "title": gallery.title,
        "region": gallery.region,
        "status": gallery.status,
        "default_station_id": gallery.default_station_id,
        "stations": [
            {
                "id": station.id,
                "order": station.order,
                "time_range": station.time_range,
                "placement_basis": station.placement_basis,
                "side": station.side,
                "artifact": _artifact(station.artifact),
                "comparison_artifacts": [
                    _artifact(item) for item in station.comparison_artifacts
                ],
                "is_visible": station.is_visible,
                "is_focused": station.is_focused,
            }
            for station in gallery.stations
        ],
        "visible_artifacts": [_artifact(item) for item in gallery.visible_artifacts],
    }


def _artifact(value: Any) -> dict[str, Any] | None:
    if value is None:
        return None
    return {
        "id": value.id,
        "title": value.title,
        "museum": value.museum,
        "time_range": value.time_range,
        "material": value.material,
        "category": value.category,
        "asset_ids": list(value.asset_ids),
        "fact_card_ids": list(value.fact_card_ids),
        "story_entry_ids": list(value.story_entry_ids),
    }


def _world_time(state: SessionState) -> dict[str, Any] | None:
    if state.world_time is None:
        return None
    return {
        "start_year": state.world_time.start_year,
        "end_year": state.world_time.end_year,
        "precision": state.world_time.precision,
        "display_label": state.world_time.display_label,
    }


def _checkpoint(value: Any) -> dict[str, str | None] | None:
    if value is None:
        return None
    result = {}
    if value.last_started_node_id is not None:
        result["last_started_node_id"] = value.last_started_node_id
    if value.last_completed_node_id is not None:
        result["last_completed_node_id"] = value.last_completed_node_id
    return result


def _camera(value: Any) -> dict[str, float]:
    return {"yaw": value.yaw, "pitch": value.pitch, "zoom": value.zoom}


def _return_point(value: Any) -> dict[str, Any]:
    result: dict[str, Any] = {
        "story_id": value.story_id,
        "node_id": value.node_id,
        "revision": value.revision,
        "story_variables": dict(value.story_variables),
    }
    if value.narration_checkpoint is not None:
        result["narration_checkpoint"] = _checkpoint(value.narration_checkpoint)
    return result
