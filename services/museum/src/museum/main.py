from __future__ import annotations

import os
from pathlib import Path

from aiohttp import web

from museum.adapters.content.published_catalog import PublishedCatalog
from museum.adapters.http.auth import SessionAuthenticator
from museum.adapters.http.command_routes import register_command_routes
from museum.adapters.http.event_routes import register_event_routes
from museum.adapters.http.helpers import SERVICES_KEY
from museum.adapters.http.render_routes import register_render_routes
from museum.adapters.http.services import HttpServices
from museum.adapters.http.session_routes import register_session_routes
from museum.adapters.sqlite.database import SQLiteDatabase
from museum.application.binding_service import BindingService
from museum.application.command_service import CommandService
from museum.application.control_tickets import ControlTickets
from museum.application.event_hub import EventHub
from museum.application.query_service import QueryService
from museum.application.render_service import RenderService
from museum.ports.content_catalog import ContentCatalog


async def health(_: web.Request) -> web.Response:
    return web.json_response({"status": "ok", "service": "museum-game"})


def create_app(
    *,
    database: SQLiteDatabase | None = None,
    catalog: ContentCatalog | None = None,
    allowed_origins: frozenset[str] | None = None,
) -> web.Application:
    if database is None:
        database = SQLiteDatabase(
            os.getenv("MUSEUM_DB_PATH", str(Path(".data") / "museum.sqlite3"))
        )
    if catalog is None:
        catalog = PublishedCatalog(Path(os.getenv("MUSEUM_CONTENT_ROOT", "published")))
    tickets = ControlTickets()
    services = HttpServices(
        database=database,
        catalog=catalog,
        query=QueryService(catalog),
        commands=CommandService(database.transaction, catalog, tickets),
        authenticator=SessionAuthenticator(),
        bindings=BindingService(tickets),
        event_hub=EventHub(),
        renders=RenderService(),
        allowed_origins=(
            allowed_origins
            if allowed_origins is not None
            else frozenset(
                item.strip()
                for item in os.getenv(
                    "MUSEUM_ALLOWED_ORIGINS",
                    "http://127.0.0.1:5173,http://localhost:5173",
                ).split(",")
                if item.strip()
            )
        ),
    )
    app = web.Application(client_max_size=16 * 1024)
    app[SERVICES_KEY] = services
    app.router.add_get("/health", health)
    register_session_routes(app)
    register_command_routes(app)
    register_event_routes(app)
    register_render_routes(app)
    return app


if __name__ == "__main__":
    web.run_app(
        create_app(),
        host=os.getenv("MUSEUM_HOST", "127.0.0.1"),
        port=int(os.getenv("MUSEUM_PORT", "8780")),
        print=None,
    )
