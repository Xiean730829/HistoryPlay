from __future__ import annotations


class RenderReplyGate:
    """Holds one navigation reply until that exact committed view is visibly rendered."""

    def __init__(self, max_bytes: int = 2 * 1024 * 1024) -> None:
        self.max_bytes = max_bytes
        self.request_id: str | None = None
        self.items: list[tuple[str, object]] = []
        self.size = 0
        self.drop = False

    def begin(self, request_id: str) -> None:
        self.request_id = request_id
        self.items.clear()
        self.size = 0
        self.drop = False

    def hold(self, kind: str, payload: object, size: int) -> bool:
        if self.drop:
            return True
        if self.request_id is None:
            return False
        if size < 0 or self.size + size > self.max_bytes:
            self.items.clear()
            self.size = 0
            self.drop = True
            return True
        self.items.append((kind, payload))
        self.size += size
        return True

    def resolve(self, request_id: str, status: str) -> list[tuple[str, object]] | None:
        if request_id != self.request_id or status not in {"rendered", "degraded"}:
            return None
        released = self.items.copy() if status == "rendered" and not self.drop else []
        self.request_id = None
        self.items.clear()
        self.size = 0
        self.drop = status != "rendered" or self.drop
        return released

    def expire(self, request_id: str) -> bool:
        if request_id != self.request_id:
            return False
        self.request_id = None
        self.items.clear()
        self.size = 0
        self.drop = True
        return True
