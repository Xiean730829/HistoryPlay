from __future__ import annotations

import asyncio
from collections import defaultdict


class EventHub:
    """In-process wakeups for WebSocket clients; the durable event log stays authoritative."""

    def __init__(self) -> None:
        self._subscribers: dict[str, set[asyncio.Queue[None]]] = defaultdict(set)

    def subscribe(self, session_id: str) -> asyncio.Queue[None]:
        queue: asyncio.Queue[None] = asyncio.Queue(maxsize=1)
        self._subscribers[session_id].add(queue)
        return queue

    def unsubscribe(self, session_id: str, queue: asyncio.Queue[None]) -> None:
        subscribers = self._subscribers.get(session_id)
        if subscribers is None:
            return
        subscribers.discard(queue)
        if not subscribers:
            del self._subscribers[session_id]

    def publish(self, session_id: str) -> None:
        for queue in tuple(self._subscribers.get(session_id, ())):
            if queue.empty():
                queue.put_nowait(None)
