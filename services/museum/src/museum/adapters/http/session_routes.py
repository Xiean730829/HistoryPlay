from __future__ import annotations

from uuid import uuid4

from aiohttp import web

from museum.adapters.http.auth import require_allowed_origin
from museum.adapters.http.helpers import (
    context_projection,
    gallery_projection,
    load_state,
    require_binding,
    require_session,
    services,
    state_projection,
)
from museum.domain.session.models import SessionState


def register_session_routes(app: web.Application) -> None:
    app.router.add_post("/api/sessions", create_session)
    app.router.add_get("/api/sessions/{session_id}", get_session)
    app.router.add_post("/api/sessions/{session_id}/pair", pair_session)
    app.router.add_delete("/api/sessions/{session_id}/pair", unpair_session)
    app.router.add_get("/api/sessions/{session_id}/context", get_context)
    app.router.add_get("/api/sessions/{session_id}/galleries/{gallery_id}", get_gallery)
    app.router.add_get("/api/sessions/{session_id}/search", search_content)
    app.router.add_get("/api/sessions/{session_id}/facts/{fact_id}", read_fact)
    app.router.add_get("/api/sessions/{session_id}/content", read_content)
    app.router.add_post("/api/sessions/{session_id}/events/ticket", issue_event_ticket)


async def create_session(request: web.Request) -> web.Response:
    configured = services(request)
    try:
        require_allowed_origin(request.headers.get("Origin"), configured.allowed_origins)
    except PermissionError as error:
        raise web.HTTPForbidden(text=str(error)) from error
    try:
        body = await request.json()
    except (ValueError, web.HTTPBadRequest) as error:
        raise web.HTTPBadRequest(text="请求体必须是JSON对象") from error
    if not isinstance(body, dict) or set(body) != {"pack_id", "version"}:
        raise web.HTTPBadRequest(text="请求必须只包含pack_id和version")
    pack_id, version = body["pack_id"], body["version"]
    if not isinstance(pack_id, str) or not isinstance(version, str):
        raise web.HTTPBadRequest(text="pack_id和version必须是字符串")
    try:
        configured.catalog.get_published(pack_id, version)
    except LookupError as error:
        raise web.HTTPNotFound(text="指定的已发布内容包不可用") from error

    session_id = uuid4().hex
    state = SessionState(session_id=session_id, pack_versions={pack_id: version})
    with configured.database.transaction() as unit:
        unit.sessions.create(state)
    token = configured.authenticator.issue(session_id)
    return web.json_response({"session_token": token, "state": state_projection(state)}, status=201)


async def get_session(request: web.Request) -> web.Response:
    session_id = request.match_info["session_id"]
    configured = require_session(request, session_id)
    return web.json_response(state_projection(load_state(configured, session_id)))


async def pair_session(request: web.Request) -> web.Response:
    session_id = request.match_info["session_id"]
    configured = require_session(request, session_id, mutation=True)
    load_state(configured, session_id)
    binding = configured.bindings.pair(session_id)
    return web.json_response(
        {
            "session_id": binding.session_id,
            "connection_id": binding.connection_id,
            "control_ticket": binding.control_ticket,
            "ticket_ttl_seconds": 300,
        },
        status=201,
    )


async def unpair_session(request: web.Request) -> web.Response:
    session_id = request.match_info["session_id"]
    configured = require_session(request, session_id, mutation=True)
    connection_id = require_binding(request, configured, session_id)
    configured.bindings.revoke(session_id, connection_id)
    return web.json_response({"status": "unpaired"})


async def issue_event_ticket(request: web.Request) -> web.Response:
    session_id = request.match_info["session_id"]
    configured = require_session(request, session_id, mutation=True)
    connection_id = require_binding(request, configured, session_id)
    load_state(configured, session_id)
    origin = request.headers.get("Origin")
    if origin is None:
        raise web.HTTPForbidden(text="事件通道请求缺少来源")
    ticket = configured.event_tickets.issue(
        session_id=session_id,
        connection_id=connection_id,
        origin=origin,
    )
    return web.json_response(
        {"ticket": ticket, "ticket_ttl_seconds": configured.event_tickets.TTL_SECONDS},
        status=201,
        headers={"Cache-Control": "no-store"},
    )


async def get_context(request: web.Request) -> web.Response:
    session_id = request.match_info["session_id"]
    configured = require_session(request, session_id)
    require_binding(request, configured, session_id)
    state = load_state(configured, session_id)
    try:
        context = configured.query.context(state)
    except LookupError as error:
        raise web.HTTPConflict(text=str(error)) from error
    return web.json_response(context_projection(context))


async def get_gallery(request: web.Request) -> web.Response:
    session_id = request.match_info["session_id"]
    configured = require_session(request, session_id)
    require_binding(request, configured, session_id)
    state = load_state(configured, session_id)
    try:
        gallery = configured.query.gallery(state, request.match_info["gallery_id"])
    except LookupError as error:
        raise web.HTTPNotFound(text=str(error)) from error
    return web.json_response(gallery_projection(gallery))


async def search_content(request: web.Request) -> web.Response:
    session_id = request.match_info["session_id"]
    configured = require_session(request, session_id)
    require_binding(request, configured, session_id)
    state = load_state(configured, session_id)
    try:
        limit = int(request.query.get("limit", "20"))
        page = configured.query.search(
            state,
            request.query.get("q", ""),
            kind=request.query.get("kind"),
            cursor=request.query.get("cursor"),
            limit=limit,
        )
    except (ValueError, LookupError) as error:
        raise web.HTTPBadRequest(text=str(error)) from error
    return web.json_response(
        {
            "items": [
                {
                    "id": item.id,
                    "kind": item.kind,
                    "title": item.title,
                    "summary": item.summary,
                    "pack_id": item.pack_id,
                    "version": item.version,
                }
                for item in page.items
            ],
            "next_cursor": page.next_cursor,
        }
    )


async def read_fact(request: web.Request) -> web.Response:
    session_id = request.match_info["session_id"]
    configured = require_session(request, session_id)
    require_binding(request, configured, session_id)
    state = load_state(configured, session_id)
    try:
        fact = configured.query.read_fact(state, request.match_info["fact_id"])
    except LookupError as error:
        raise web.HTTPNotFound(text=str(error)) from error
    return web.json_response(
        {
            "id": fact.id,
            "claim": fact.claim,
            "grade": fact.grade,
            "applicable_time": fact.applicable_time,
            "evidence_note": fact.evidence_note,
            "dispute": fact.dispute,
            "sources": [
                {
                    "id": source.id,
                    "kind": source.kind,
                    "title": source.title,
                    "locator": source.locator,
                    "citation_license": source.citation_license,
                }
                for source in fact.sources
            ],
        }
    )


async def read_content(request: web.Request) -> web.Response:
    session_id = request.match_info["session_id"]
    configured = require_session(request, session_id)
    require_binding(request, configured, session_id)
    state = load_state(configured, session_id)
    pack_id = request.query.get("pack_id", "")
    version = request.query.get("version", "")
    content_id = request.query.get("content_id", "")
    if not all((pack_id, version, content_id)):
        raise web.HTTPBadRequest(text="必须提供pack_id、version和content_id")
    try:
        page = configured.query.read_content(
            state,
            pack_id=pack_id,
            version=version,
            content_id=content_id,
            cursor=request.query.get("cursor"),
            limit=int(request.query.get("limit", "10")),
            byte_budget=int(request.query.get("byte_budget", "4096")),
        )
    except ValueError as error:
        raise web.HTTPBadRequest(text=str(error)) from error
    except LookupError as error:
        raise web.HTTPNotFound(text=str(error)) from error
    return web.json_response(
        {
            "content_id": page.content_id,
            "content_kind": page.content_kind,
            "pack_id": page.pack_id,
            "version": page.version,
            "title": page.title,
            "artifact_id": page.artifact_id,
            "paragraphs": [
                {
                    "content_id": item.content_id,
                    "version": page.version,
                    "paragraph_number": item.paragraph_number,
                    "text": item.text,
                    "authorship": {
                        "node_id": item.content_id,
                        "story_id": item.story_id,
                        "fact_grade": item.fact_grade,
                    },
                    "presentation": item.presentation,
                    "allowed_actions": list(item.allowed_actions),
                }
                for item in page.paragraphs
            ],
            "related_facts": [
                {
                    "id": fact.id,
                    "claim": fact.claim,
                    "grade": fact.grade,
                    "applicable_time": fact.applicable_time,
                    "evidence_note": fact.evidence_note,
                    "dispute": fact.dispute,
                    "sources": [
                        {
                            "id": source.id,
                            "kind": source.kind,
                            "title": source.title,
                            "locator": source.locator,
                            "citation_license": source.citation_license,
                        }
                        for source in fact.sources
                    ],
                }
                for fact in page.related_facts
            ],
            "text_bytes": page.text_bytes,
            "next_cursor": page.next_cursor,
        }
    )
