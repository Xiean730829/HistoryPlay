from __future__ import annotations

import json
import re
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit


@dataclass(frozen=True)
class DeviceConfig:
    device_id: str = field(repr=False)
    client_id: str = field(repr=False)
    websocket_url: str = field(repr=False)
    token: str = field(repr=False)
    version: int = 1

    def __post_init__(self) -> None:
        if not re.fullmatch(r"(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}", self.device_id):
            raise ValueError("固定设备Device-Id无效")
        try:
            uuid.UUID(self.client_id)
        except ValueError:
            raise ValueError("固定设备Client-Id无效") from None
        parsed = urlsplit(self.websocket_url)
        if (
            parsed.scheme != "wss"
            or parsed.hostname not in {"api.tenclass.net", "api.xiaozhi.me"}
            or parsed.username
            or parsed.password
            or parsed.port not in (None, 443)
            or parsed.fragment
        ):
            raise ValueError("设备令牌仅能发送到小智官方WSS地址")
        if not self.token or len(self.token) > 16384 or any(c in self.token for c in "\r\n"):
            raise ValueError("固定设备令牌缺失或无效")
        if self.version not in (1, 2, 3):
            raise ValueError("仅支持小智WebSocket协议1/2/3")

    @classmethod
    def load(cls, path: Path) -> DeviceConfig:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            websocket = data["websocket"]
            return cls(
                data["device_id"],
                data["client_id"],
                websocket["url"],
                websocket["token"],
                websocket.get("version", 1),
            )
        except (OSError, ValueError, TypeError, KeyError, AttributeError):
            raise ValueError("本机固定设备配置缺失或无效，请恢复原设备配置") from None
