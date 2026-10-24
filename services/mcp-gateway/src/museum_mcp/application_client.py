from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import quote, urlsplit

import aiohttp


class GatewayError(RuntimeError):
    """A safe, user-facing error; never includes upstream bodies or credentials."""


@dataclass(frozen=True)
class BoundSession:
    base_url: str
    session_id: str
    session_token: str = field(repr=False)
    connection_id: str = field(repr=False)

    def __post_init__(self) -> None:
        url = urlsplit(self.base_url)
        if (
            url.scheme != "http"
            or url.hostname != "127.0.0.1"
            or url.username
            or url.password
            or url.path not in ("", "/")
            or url.query
            or url.fragment
            or url.port is None
        ):
            raise ValueError("游戏服务必须是带端口的127.0.0.1 HTTP地址")
        for value in (self.session_id, self.session_token, self.connection_id):
            if not value or len(value) > 512 or any(char.isspace() for char in value):
                raise ValueError("缺少有效的本机展台绑定")


class ApplicationClient:
    MAX_RESPONSE_BYTES = 64 * 1024

    def __init__(self, binding: BoundSession) -> None:
        self.binding = binding

    async def get(self, route: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        if route not in {"context", "search", "content"}:
            raise GatewayError("不允许的只读接口")
        url = (
            f"{self.binding.base_url.rstrip('/')}/api/sessions/"
            f"{quote(self.binding.session_id, safe='')}/{route}"
        )
        headers = {
            "Authorization": f"Bearer {self.binding.session_token}",
            "X-Museum-Connection": self.binding.connection_id,
        }
        try:
            async with (
                aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=8)) as client,
                client.get(url, headers=headers, params=params, allow_redirects=False) as response,
            ):
                if response.status != 200:
                    if response.status in (401, 403):
                        raise GatewayError("展台绑定已失效，请在当前页面重新连接语音")
                    raise GatewayError(f"游戏查询暂不可用（HTTP {response.status}）")
                body = bytearray()
                async for chunk in response.content.iter_chunked(4096):
                    body.extend(chunk)
                    if len(body) > self.MAX_RESPONSE_BYTES:
                        raise GatewayError("游戏查询响应过大，请缩小查询")
                result = json.loads(body)
                if not isinstance(result, dict):
                    raise GatewayError("游戏查询返回格式不正确")
                return result
        except (aiohttp.ClientError, TimeoutError):
            raise GatewayError("无法连接本机游戏服务，请检查游戏是否启动") from None
        except (ValueError, UnicodeError):
            raise GatewayError("游戏查询返回格式不正确") from None
