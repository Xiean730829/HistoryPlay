from __future__ import annotations

from aiohttp import web

from museum.adapters.http.auth import OriginRejected, require_allowed_origin
from museum.adapters.http.helpers import load_state, require_session
from museum.adapters.http.services import HttpServices
from museum.ports.asset_store import AssetNotFound, StoredAsset
from museum.ports.content_catalog import PublishedPack

_MEDIA_TYPES = {
    "png": "image/png",
    "jpg": "image/jpeg",
    "webp": "image/webp",
    "glb": "model/gltf-binary",
    "mp3": "audio/mpeg",
    "ogg": "audio/ogg",
}


def register_asset_routes(app: web.Application) -> None:
    app.router.add_get("/api/sessions/{session_id}/assets/{asset_id}", get_asset)


async def get_asset(request: web.Request) -> web.Response:
    session_id = request.match_info["session_id"]
    asset_id = request.match_info["asset_id"]
    configured = require_session(request, session_id)
    origin = request.headers.get("Origin")
    if origin is not None:
        try:
            require_allowed_origin(origin, configured.allowed_origins)
        except OriginRejected as error:
            raise web.HTTPForbidden(text=str(error)) from error
    state = load_state(configured, session_id)
    try:
        stored = _resolve_asset(configured, state.pack_versions, asset_id)
    except AssetNotFound as error:
        raise web.HTTPNotFound(text="指定的展示资产不可用") from error
    except LookupError as error:
        raise web.HTTPNotFound(text="指定的展示资产不可用") from error
    body = stored.path.read_bytes()
    headers = {
        "Content-Type": _MEDIA_TYPES.get(stored.format, "application/octet-stream"),
        "Content-Length": str(stored.byte_size),
        "ETag": f'"{stored.sha256}"',
        "Cache-Control": "private, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
    }
    if origin is not None:
        headers["Access-Control-Allow-Origin"] = origin
        headers["Vary"] = "Origin"
    return web.Response(body=body, headers=headers)


def _resolve_asset(
    configured: HttpServices, pack_versions: dict[str, str], asset_id: str
) -> StoredAsset:
    for pack_id, version in pack_versions.items():
        pack = configured.catalog.get_published(pack_id, version)
        document = _asset_document(pack, asset_id)
        if document is None:
            continue
        stored = configured.assets.get(pack_id, version, asset_id)
        if stored.sha256 != document.get("sha256") or stored.byte_size != document.get("byte_size"):
            raise AssetNotFound(f"展示资产与内容包清单不一致：{asset_id}")
        return stored
    raise AssetNotFound(f"会话内容包未引用该资产：{asset_id}")


def _asset_document(pack: PublishedPack, asset_id: str) -> dict | None:
    for relative, data in pack.documents.items():
        if not relative.startswith("assets/") or not isinstance(data, dict):
            continue
        if data.get("id") == asset_id:
            return data
    return None
