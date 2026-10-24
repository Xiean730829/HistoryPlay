from __future__ import annotations

import asyncio

import pytest
from aiohttp import WSServerHandshakeError
from aiohttp.test_utils import TestClient, TestServer
from museum.adapters.sqlite.database import SQLiteDatabase
from museum.application.event_tickets import EventTickets, InvalidEventTicket
from museum.main import create_app
from museum.ports.content_catalog import PublishedPack

ORIGIN = "http://localhost:5173"
PACK_ID = "cn.tang.core"
VERSION = "1.0.0"


class MemoryCatalog:
    def get_published(self, pack_id: str, version: str) -> PublishedPack:
        if (pack_id, version) != (PACK_ID, VERSION):
            raise LookupError("content version not found")
        return PublishedPack(
            PACK_ID,
            VERSION,
            "1",
            {"manifest.json": {"id": PACK_ID, "version": VERSION}},
        )


def make_app(tmp_path):
    database = SQLiteDatabase(tmp_path / "events.sqlite3")
    return create_app(
        database=database,
        catalog=MemoryCatalog(),
        allowed_origins=frozenset({ORIGIN}),
    )


def test_event_ticket_is_expiring_scoped_and_one_time() -> None:
    now = [10.0]
    tickets = EventTickets(clock=lambda: now[0])
    ticket = tickets.issue(session_id="session-a", connection_id="connection-a", origin=ORIGIN)

    with pytest.raises(InvalidEventTicket):
        tickets.consume(ticket, session_id="session-b", origin=ORIGIN)
    with pytest.raises(InvalidEventTicket):
        tickets.consume(ticket, session_id="session-a", origin="https://attacker.test")
    with pytest.raises(InvalidEventTicket):
        tickets.consume(ticket, session_id="session-a", origin=ORIGIN)

    ticket = tickets.issue(session_id="session-a", connection_id="connection-a", origin=ORIGIN)
    assert tickets.consume(ticket, session_id="session-a", origin=ORIGIN) == "connection-a"
    with pytest.raises(InvalidEventTicket):
        tickets.consume(ticket, session_id="session-a", origin=ORIGIN)

    ticket = tickets.issue(session_id="session-a", connection_id="connection-a", origin=ORIGIN)
    now[0] += tickets.TTL_SECONDS
    with pytest.raises(InvalidEventTicket):
        tickets.consume(ticket, session_id="session-a", origin=ORIGIN)


async def _create_bound_session(client: TestClient) -> tuple[str, dict[str, str]]:
    created_response = await client.post(
        "/api/sessions",
        json={"pack_id": PACK_ID, "version": VERSION},
        headers={"Origin": ORIGIN},
    )
    created = await created_response.json()
    session_id = created["state"]["session_id"]
    headers = {"Origin": ORIGIN, "Authorization": f"Bearer {created['session_token']}"}
    paired = await client.post(f"/api/sessions/{session_id}/pair", headers=headers)
    binding = await paired.json()
    return session_id, {**headers, "X-Museum-Connection": binding["connection_id"]}


async def _issue_ticket(client: TestClient, session_id: str, headers: dict[str, str]) -> str:
    response = await client.post(
        f"/api/sessions/{session_id}/events/ticket", headers=headers
    )
    assert response.status == 201
    payload = await response.json()
    assert payload["ticket_ttl_seconds"] == 60
    assert response.headers["Cache-Control"] == "no-store"
    return payload["ticket"]


def test_event_handshake_uses_one_time_scoped_browser_ticket(tmp_path) -> None:
    async def scenario() -> None:
        client = TestClient(TestServer(make_app(tmp_path)))
        await client.start_server()
        session_id, headers = await _create_bound_session(client)
        ticket = await _issue_ticket(client, session_id, headers)
        url = f"/api/sessions/{session_id}/events"
        protocols = ["museum-events.v1", f"museum-ticket.{ticket}"]

        socket = await client.ws_connect(
            url, protocols=protocols, headers={"Origin": ORIGIN}
        )
        assert socket.protocol == "museum-events.v1"
        initial = await socket.receive_json(timeout=1)
        assert initial["type"] == "snapshot"
        await socket.close()

        with pytest.raises(WSServerHandshakeError) as replay:
            await client.ws_connect(url, protocols=protocols, headers={"Origin": ORIGIN})
        assert replay.value.status == 403
        await client.close()

    asyncio.run(scenario())


def test_event_handshake_rejects_missing_wrong_origin_and_revoked_binding(tmp_path) -> None:
    async def scenario() -> None:
        client = TestClient(TestServer(make_app(tmp_path)))
        await client.start_server()
        session_id, headers = await _create_bound_session(client)
        url = f"/api/sessions/{session_id}/events"

        with pytest.raises(WSServerHandshakeError) as missing:
            await client.ws_connect(
                url,
                protocols=["museum-events.v1"],
                headers={"Origin": ORIGIN},
            )
        assert missing.value.status == 401

        ticket = await _issue_ticket(client, session_id, headers)
        protocols = ["museum-events.v1", f"museum-ticket.{ticket}"]
        with pytest.raises(WSServerHandshakeError) as wrong_origin:
            await client.ws_connect(
                url,
                protocols=protocols,
                headers={"Origin": "https://attacker.test"},
            )
        assert wrong_origin.value.status == 403

        unpaired = await client.delete(
            f"/api/sessions/{session_id}/pair", headers=headers
        )
        assert unpaired.status == 200
        with pytest.raises(WSServerHandshakeError) as revoked:
            await client.ws_connect(url, protocols=protocols, headers={"Origin": ORIGIN})
        assert revoked.value.status == 403
        await client.close()

    asyncio.run(scenario())


def test_event_handshake_ticket_cannot_be_redeemed_for_another_session(tmp_path) -> None:
    async def scenario() -> None:
        client = TestClient(TestServer(make_app(tmp_path)))
        await client.start_server()
        first_id, first_headers = await _create_bound_session(client)
        second_id, _ = await _create_bound_session(client)
        ticket = await _issue_ticket(client, first_id, first_headers)
        url = f"/api/sessions/{second_id}/events"
        protocols = ["museum-events.v1", f"museum-ticket.{ticket}"]

        with pytest.raises(WSServerHandshakeError) as wrong_session:
            await client.ws_connect(url, protocols=protocols, headers={"Origin": ORIGIN})
        assert wrong_session.value.status == 403
        await client.close()

    asyncio.run(scenario())
