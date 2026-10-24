from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path

from aiohttp import (
    ClientError,
    ClientSession,
    ClientTimeout,
    ClientWSTimeout,
    TraceConfig,
    WSMsgType,
    web,
)
from av.error import FFmpegError

from museum_voice.codec import AudioCodec, pack_audio, unpack_audio
from museum_voice.config import DeviceConfig
from museum_voice.xiaozhi_client import connection_headers, hello_message

DEVICE = web.AppKey("fixed_device", DeviceConfig)
ORIGIN = web.AppKey("web_origin", str)
HOST = web.AppKey("bridge_host", str)
ACTIVE = web.AppKey("active_audio", set)


async def reject_redirect(*args) -> None:
    raise ValueError("不允许携带设备凭据跳转到其他地址")


@web.middleware
async def local_only(request: web.Request, handler):
    if request.host != request.app[HOST]:
        raise web.HTTPForbidden(text="请使用本机语音桥地址")
    if request.path == "/voice/ws" and request.headers.get("Origin") != request.app[ORIGIN]:
        raise web.HTTPForbidden(text="语音桥仅接受配置的本机游戏页面")
    response = await handler(request)
    response.headers["Cache-Control"] = "no-store"
    return response


async def bridge(request: web.Request) -> web.WebSocketResponse:
    if request.app[ACTIVE]:
        raise web.HTTPConflict(text="固定设备已被当前语音连接使用，请先暂停旧页面")
    browser = web.WebSocketResponse(heartbeat=20, max_msg_size=16384)
    request.app[ACTIVE].add(browser)
    tasks: list[asyncio.Task] = []
    upstream = None
    try:
        await browser.prepare(request)
        device = request.app[DEVICE]
        codec = AudioCodec()
        trace = TraceConfig()
        trace.on_request_redirect.append(reject_redirect)
        async with ClientSession(
            timeout=ClientTimeout(total=None, sock_connect=15), trace_configs=[trace]
        ) as client:
            upstream = await client.ws_connect(
                device.websocket_url,
                headers=connection_headers(device),
                heartbeat=20,
                max_msg_size=2 * 1024 * 1024,
                autoping=True,
                timeout=ClientWSTimeout(ws_close=1),
            )
            await upstream.send_json(hello_message(device))
            hello = await asyncio.wait_for(upstream.receive_json(), 12)
            if (
                not isinstance(hello, dict)
                or hello.get("type") != "hello"
                or hello.get("transport") != "websocket"
            ):
                raise ValueError("官方未接受设备握手")
            session_id = hello.get("session_id", "")
            await browser.send_json({"type": "ready", "sample_rate": 24000})

            async def send_microphone() -> None:
                async for message in browser:
                    if message.type == WSMsgType.BINARY:
                        for packet in codec.encode(message.data):
                            await upstream.send_bytes(pack_audio(packet, device.version))
                    elif message.type == WSMsgType.TEXT:
                        command = json.loads(message.data)
                        if not isinstance(command, dict):
                            raise ValueError("语音操作必须是JSON对象")
                        op = command.get("op")
                        if op == "start":
                            mode = command.get("mode", "manual")
                            if mode not in {"auto", "manual", "realtime"}:
                                raise ValueError("不支持的聆听模式")
                            await upstream.send_json(
                                {
                                    "type": "listen",
                                    "state": "start",
                                    "mode": mode,
                                    "session_id": session_id,
                                }
                            )
                        elif op == "stop":
                            await upstream.send_json(
                                {
                                    "type": "listen",
                                    "state": "stop",
                                    "session_id": session_id,
                                }
                            )
                        elif op == "abort":
                            await upstream.send_json({"type": "abort", "session_id": session_id})
                            # No reliable cloud per-turn ID was verified. Retire this transport;
                            # a late tts.start on it cannot be promoted to the next local turn.
                            await upstream.close()
                            return
                        else:
                            raise ValueError("不支持的语音操作")

            async def receive_reply() -> None:
                async for message in upstream:
                    if message.type == WSMsgType.BINARY:
                        for pcm in codec.decode(unpack_audio(message.data, device.version)):
                            await browser.send_bytes(pcm)
                    elif message.type == WSMsgType.TEXT:
                        event = json.loads(message.data)
                        if not isinstance(event, dict):
                            raise ValueError("云端语音事件必须是JSON对象")
                        if event.get("type") == "tts" and event.get("state") == "start":
                            codec.reset_decoder()
                        if event.get("type") in {"stt", "tts", "llm", "alert", "goodbye"}:
                            safe = {
                                key: event[key] for key in ("type", "state", "text") if key in event
                            }
                            await browser.send_json(safe)

            tasks = [asyncio.create_task(send_microphone()), asyncio.create_task(receive_reply())]
            done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                task.result()
    except (ClientError, OSError, ValueError, TimeoutError, FFmpegError):
        # Network exception repr, URL and headers can contain device credentials.
        if browser.prepared and not browser.closed:
            await browser.send_json(
                {"type": "bridge_error", "message": "语音连接中止，请恢复固定设备连接配置后重试"}
            )
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        if upstream is not None:
            await upstream.close()
        request.app[ACTIVE].discard(browser)
        if browser.prepared:
            await browser.close()
    return browser


async def health(request: web.Request) -> web.Response:
    return web.json_response({"service": "museum-voice", "status": "ok", "device_configured": True})


def create_app(
    device: DeviceConfig, *, port: int = 8781, origin: str = "http://127.0.0.1:5173"
) -> web.Application:
    if origin not in {"http://127.0.0.1:5173", "http://127.0.0.1:5174"}:
        raise ValueError("语音桥只允许本机5173或5174游戏页面")
    app = web.Application(middlewares=[local_only])
    app[DEVICE] = device
    app[ORIGIN] = origin
    app[HOST] = f"127.0.0.1:{port}"
    app[ACTIVE] = set()
    app.router.add_get("/health", health)
    app.router.add_get("/voice/ws", bridge)
    return app


def main() -> None:
    path = os.environ.get("MUSEUM_XIAOZHI_DEVICE_FILE")
    if not path:
        raise SystemExit("请设置MUSEUM_XIAOZHI_DEVICE_FILE指向本机私密设备配置")
    try:
        device = DeviceConfig.load(Path(path))
    except ValueError as error:
        raise SystemExit(str(error)) from None
    port = int(os.environ.get("MUSEUM_VOICE_PORT", "8781"))
    origin = os.environ.get("MUSEUM_WEB_ORIGIN", "http://127.0.0.1:5173")
    web.run_app(
        create_app(device, port=port, origin=origin),
        host="127.0.0.1",
        port=port,
        access_log=None,
        print=None,
    )


if __name__ == "__main__":
    main()
