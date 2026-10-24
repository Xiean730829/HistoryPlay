from __future__ import annotations

import hashlib
import re
import secrets


class AuthenticationError(PermissionError):
    """A bearer credential is absent, invalid, or scoped to another session."""


class OriginRejected(PermissionError):
    """A browser request came from an origin outside the configured allowlist."""


class SessionAuthenticator:
    """Issues high-entropy in-memory session credentials; raw tokens are never indexed."""

    def __init__(self) -> None:
        self._sessions_by_digest: dict[bytes, str] = {}

    def issue(self, session_id: str) -> str:
        token = secrets.token_urlsafe(32)
        self._sessions_by_digest[self._digest(token)] = session_id
        return token

    def authenticate(self, authorization: str | None, session_id: str) -> None:
        if not authorization or not authorization.startswith("Bearer "):
            raise AuthenticationError("需要会话Bearer凭证")
        token = authorization[7:]
        if not re.fullmatch(r"[A-Za-z0-9_-]{16,128}", token):
            raise AuthenticationError("会话凭证无效")
        owner = self._sessions_by_digest.get(self._digest(token))
        if owner is None or not secrets.compare_digest(owner, session_id):
            raise AuthenticationError("会话凭证无效或不属于该会话")

    def revoke(self, session_id: str) -> int:
        revoked = [key for key, owner in self._sessions_by_digest.items() if owner == session_id]
        for key in revoked:
            del self._sessions_by_digest[key]
        return len(revoked)

    @staticmethod
    def _digest(token: str) -> bytes:
        return hashlib.sha256(token.encode("ascii")).digest()


def require_allowed_origin(origin: str | None, allowed_origins: frozenset[str]) -> None:
    if origin is None or origin not in allowed_origins:
        raise OriginRejected("请求来源不在允许列表中")
