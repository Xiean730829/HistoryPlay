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
from museum_mcp.action_tools import TrustedInput
from museum_mcp.application_client import GatewayError
from museum_mcp.intent_adapter import interpret

from museum_voice.codec import AudioCodec, pack_audio, unpack_audio
from museum_voice.config import DeviceConfig
from museum_voice.control_orchestrator import InputOrchestrator
from museum_voice.game_binding import ACTIVE_AUDIO, BINDING_FILE, GAME_BINDINGS, bind_game
from museum_voice.xiaozhi_client import connection_headers, hello_message

DEVICE = web.AppKey("fixed_device", DeviceConfig)
ORIGIN = web.AppKey("web_origin", str)
HOST = web.AppKey("bridge_host", str)
ACTIVE = ACTIVE_AUDIO


async def reject_redirect(*args) -> None:
    raise ValueError("不允许携带设备凭据跳转到其他地址")


@web.middleware
async def local_only(request: web.Request, handler):
    if request.host != request.app[HOST]:
        raise web.HTTPForbidden(text="请使用本机语音桥地址")
    if request.path.startswith("/voice/") and request.headers.get("Origin") != request.app[ORIGIN]:
        raise web.HTTPForbidden(text="语音桥仅接受配置的本机游戏页面")
    if request.method == "OPTIONS":
        response = web.Response()
    else:
        response = await handler(request)
    response.headers["Cache-Control"] = "no-store"
    if request.path.startswith("/voice/"):
        response.headers["Access-Control-Allow-Origin"] = request.app[ORIGIN]
        response.headers["Access-Control-Allow-Headers"] = "Content-Type"
        response.headers["Access-Control-Allow-Methods"] = "POST, OPTIONS"
    return response


async def bridge(request: web.Request) -> web.WebSocketResponse:
    if request.app[ACTIVE]:
        raise web.HTTPConflict(text="固定设备已被当前语音连接使用，请先暂停旧页面")
    browser = web.WebSocketResponse(heartbeat=20, max_msg_size=16384)
    request.app[ACTIVE].add(browser)
    tasks: list[asyncio.Task] = []
    upstream = None
    orchestrator = None
    try:
        await browser.prepare(request)
        if request.app.get(DEVICE) is None:
            raise ValueError("固定设备尚未配置，只读展台绑定可用")
        first = await asyncio.wait_for(browser.receive_json(), 5)
        if not isinstance(first, dict) or first.get("op") != "bind":
            raise ValueError("音频连接必须先绑定当前展台")
        bound = request.app[GAME_BINDINGS].get(first.get("binding_id"))
        if bound is None:
            raise ValueError("当前展台语音绑定已失效")
        granted = await bound.client.voice("begin", bridge_token=bound.bridge_token)
        orchestrator = InputOrchestrator(
            bound.client, TrustedInput(bound.bridge_token, granted["input_token"])
        )
        bound.cancel_input = orchestrator.close
        input_started = False
        input_stopped = False
        pcm_frames = 0
        mute_reply = False
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
                nonlocal input_started, input_stopped, pcm_frames
                async for message in browser:
                    if message.type == WSMsgType.BINARY:
                        if not input_started or input_stopped:
                            raise ValueError("音频不属于当前输入范围")
                        pcm_frames += 1
                        for packet in codec.encode(message.data):
                            await upstream.send_bytes(pack_audio(packet, device.version))
                    elif message.type == WSMsgType.TEXT:
                        command = json.loads(message.data)
                        if not isinstance(command, dict):
                            raise ValueError("语音操作必须是JSON对象")
                        op = command.get("op")
                        if op == "start":
                            if input_started:
                                raise ValueError("每个上游连接只接受一段输入")
                            input_started = True
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
                            input_stopped = True
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
                nonlocal mute_reply
                async for message in upstream:
                    if message.type == WSMsgType.BINARY:
                        if mute_reply:
                            continue
                        for pcm in codec.decode(unpack_audio(message.data, device.version)):
                            await browser.send_bytes(pcm)
                    elif message.type == WSMsgType.TEXT:
                        event = json.loads(message.data)
                        if not isinstance(event, dict):
                            raise ValueError("云端语音事件必须是JSON对象")
                        if (
                            event.get("type") == "stt"
                            and input_started
                            and input_stopped
                            and pcm_frames >= 3
                            and not orchestrator.handled
                        ):
                            text = event.get("text", "")
                            await browser.send_json({"type": "stt", "text": text})
                            if interpret(text) is not None:
                                mute_reply = True
                                await upstream.send_json(
                                    {"type": "abort", "session_id": session_id}
                                )
                            try:
                                control = await orchestrator.handle(text)
                                if control is not None:
                                    await browser.send_json({"type": "control", "result": control})
                            except GatewayError as error:
                                await browser.send_json(
                                    {
                                        "type": "control",
                                        "result": {"kind": "error", "message": str(error)},
                                    }
                                )
                            continue
                        if event.get("type") == "stt" and orchestrator.handled:
                            continue
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
    except (ClientError, OSError, ValueError, TimeoutError, FFmpegError, GatewayError):
        # Network exception repr, URL and headers can contain device credentials.
        if browser.prepared and not browser.closed:
            await browser.send_json(
                {"type": "bridge_error", "message": "语音连接中止，请恢复固定设备连接配置后重试"}
            )
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        if orchestrator is not None:
            try:
                await orchestrator.close()
            except GatewayError:
                pass
        if upstream is not None:
            await upstream.close()
        request.app[ACTIVE].discard(browser)
        if browser.prepared:
            await browser.close()
    return browser


async def health(request: web.Request) -> web.Response:
    return web.json_response(
        {
            "service": "museum-voice",
            "status": "ok",
            "device_configured": request.app.get(DEVICE) is not None,
        }
    )


def create_app(
    device: DeviceConfig | None,
    *,
    port: int = 8782,
    origin: str = "http://127.0.0.1:5173",
    binding_file: Path | None = None,
) -> web.Application:
    if origin not in {
        "http://127.0.0.1:5173", "http://127.0.0.1:5174", "http://127.0.0.1:5175",
        "http://127.0.0.1:5176",
    }:
        raise ValueError("语音桥只允许本机5173至5176的指定游戏页面")
    app = web.Application(middlewares=[local_only])
    app[DEVICE] = device
    app[ORIGIN] = origin
    app[HOST] = f"127.0.0.1:{port}"
    app[ACTIVE] = set()
    app[GAME_BINDINGS] = {}
    if binding_file is not None:
        app[BINDING_FILE] = binding_file
    app.router.add_get("/health", health)
    app.router.add_get("/voice/status", health)
    app.router.add_get("/voice/ws", bridge)
    app.router.add_post("/voice/bind", bind_game)
    app.router.add_options("/voice/bind", bind_game)
    return app


def main() -> None:
    path = os.environ.get("MUSEUM_XIAOZHI_DEVICE_FILE")
    allow_unconfigured = os.environ.get("MUSEUM_VOICE_ALLOW_UNCONFIGURED") == "1"
    if not path and not allow_unconfigured:
        raise SystemExit("请设置MUSEUM_XIAOZHI_DEVICE_FILE指向本机私密设备配置")
    try:
        device = DeviceConfig.load(Path(path)) if path else None
    except ValueError as error:
        raise SystemExit(str(error)) from None
    port = int(os.environ.get("MUSEUM_VOICE_PORT", "8782"))
    origin = os.environ.get("MUSEUM_WEB_ORIGIN", "http://127.0.0.1:5173")
    binding_file = os.environ.get("MUSEUM_MCP_BINDING_FILE")
    web.run_app(
        create_app(
            device,
            port=port,
            origin=origin,
            binding_file=Path(binding_file) if binding_file else None,
        ),
        host="127.0.0.1",
        port=port,
        access_log=None,
        print=None,
    )


if __name__ == "__main__":
    main()
