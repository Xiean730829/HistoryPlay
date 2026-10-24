from __future__ import annotations

from dataclasses import dataclass

from museum.adapters.http.auth import SessionAuthenticator
from museum.adapters.sqlite.database import SQLiteDatabase
from museum.application.binding_service import BindingService
from museum.application.command_service import CommandService
from museum.application.query_service import QueryService
from museum.ports.content_catalog import ContentCatalog


@dataclass(frozen=True, slots=True)
class HttpServices:
    database: SQLiteDatabase
    catalog: ContentCatalog
    query: QueryService
    commands: CommandService
    authenticator: SessionAuthenticator
    bindings: BindingService
    allowed_origins: frozenset[str]
