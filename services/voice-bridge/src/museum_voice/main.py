from __future__ import annotations

import asyncio
import json
import os
import re
import secrets
from pathlib import Path

from aiohttp import (
    ClientError,
    ClientResponseError,
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
from museum_mcp.narration_cue import NARRATION_WAKE_CUE, NarrationCueStore, cue_path

from museum_voice.codec import AudioCodec, pack_audio, unpack_audio
from museum_voice.config import DeviceConfig
from museum_voice.control_flow import dispatch_local_control, render_request_id
from museum_voice.control_orchestrator import InputOrchestrator
from museum_voice.game_binding import ACTIVE_AUDIO, BINDING_FILE, GAME_BINDINGS, bind_game
from museum_voice.render_gate import RenderReplyGate
from museum_voice.xiaozhi_client import connection_headers, hello_message

DEVICE = web.AppKey("fixed_device", DeviceConfig)
ORIGIN = web.AppKey("web_origin", str)
ORIGINS = web.AppKey("web_origins", frozenset[str])
HOST = web.AppKey("bridge_host", str)
ACTIVE = ACTIVE_AUDIO
SUPPORTED_WEB_ORIGINS = frozenset(
    {
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
        "http://127.0.0.1:5175",
        "http://127.0.0.1:5176",
        "http://127.0.0.1:5190",
        "http://127.0.0.1:5192",
    }
)


async def reject_redirect(*args) -> None:
    raise ValueError("不允许携带设备凭据跳转到其他地址")


def fixed_text_event(text: object, session_id: str) -> dict[str, str]:
    if not isinstance(text, str) or not text.strip() or len(text) > 80:
        raise ValueError("固定文本必须是不超过80字的非空片段")
    return {
        "type": "listen",
        "state": "detect",
        "text": NARRATION_WAKE_CUE,
        "session_id": session_id,
    }


def is_tool_progress(event: dict) -> bool:
    return (event.get("type") == "tts" and bool(re.fullmatch(
        r"%\s+museum_(?:read_narration|get_context|search|read_content|act)\s*(?:\.{3}|…)?",
        str(event.get("text", "")).strip(),
    )))


def bridge_failure(stage: str, error: Exception) -> dict[str, str]:
    """Return bounded diagnostics without exposing exception text or request data."""
    if stage == "upstream_websocket_connect" and isinstance(error, ClientResponseError):
        status = error.status
        code = f"upstream_http_{status}" if 100 <= status <= 599 else "upstream_http_error"
    elif isinstance(error, TimeoutError):
        code = "timeout"
    elif isinstance(error, GatewayError):
        code = "game_service_error"
    elif isinstance(error, FFmpegError):
        code = "codec_error"
    elif isinstance(error, ClientError):
        code = "network_error"
    elif isinstance(error, OSError):
        code = "io_error"
    elif isinstance(error, ValueError):
        code = "protocol_error"
    else:
        code = "operation_error"
    return {"type": "bridge_error", "stage": stage, "code": code}


@web.middleware
async def local_only(request: web.Request, handler):
    if request.host != request.app[HOST]:
        raise web.HTTPForbidden(text="请使用本机语音桥地址")
    public_entry = request.path == "/voice/entry" and request.method == "GET"
    request_origin = request.headers.get("Origin")
    if (
        request.path.startswith("/voice/")
        and not public_entry
        and request_origin not in request.app[ORIGINS]
    ):
        raise web.HTTPForbidden(text="语音桥仅接受配置的本机游戏页面")
    if request.method == "OPTIONS":
        response = web.Response()
    else:
        response = await handler(request)
    response.headers["Cache-Control"] = "no-store"
    if public_entry:
        # The read-only endpoint is reachable only to configured page origins.
        if request_origin in request.app[ORIGINS]:
            response.headers["Access-Control-Allow-Origin"] = request_origin
            response.headers["Access-Control-Allow-Methods"] = "GET"
    elif request.path.startswith("/voice/"):
        if request_origin in request.app[ORIGINS]:
            response.headers["Access-Control-Allow-Origin"] = request_origin
        response.headers["Access-Control-Allow-Headers"] = "Content-Type"
        response.headers["Access-Control-Allow-Methods"] = "POST, OPTIONS"
    return response


async def wait_for_device_slot(active: set, timeout: float = 2.0) -> bool:
    """Allow a closing connection to finish without taking over a live one."""
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while active:
        remaining = deadline - loop.time()
        if remaining <= 0:
            return False
        await asyncio.sleep(min(0.05, remaining))
    return True


async def bridge(request: web.Request) -> web.WebSocketResponse:
    if not await wait_for_device_slot(request.app[ACTIVE]):
        raise web.HTTPConflict(text="固定设备已被当前语音连接使用，请先暂停旧页面")
    browser = web.WebSocketResponse(heartbeat=20, max_msg_size=16384)
    request.app[ACTIVE].add(browser)
    tasks: list[asyncio.Task] = []
    upstream = None
    orchestrator = None
    active_narration_id: str | None = None
    narration_store: NarrationCueStore | None = None
    stage = "browser_websocket_upgrade"
    try:
        await browser.prepare(request)
        if request.app.get(DEVICE) is None:
            raise ValueError("固定设备尚未配置，只读展台绑定可用")
        stage = "browser_bind_message"
        first = await asyncio.wait_for(browser.receive_json(), 5)
        if not isinstance(first, dict) or first.get("op") != "bind":
            raise ValueError("音频连接必须先绑定当前展台")
        bound = request.app[GAME_BINDINGS].get(first.get("binding_id"))
        if bound is None:
            raise ValueError("当前展台语音绑定已失效")
        stage = "game_begin"
        granted = await bound.client.voice("begin", bridge_token=bound.bridge_token)
        orchestrator = InputOrchestrator(
            bound.client, TrustedInput(bound.bridge_token, granted["input_token"]), bound.selection
        )
        bound.cancel_input = orchestrator.close
        input_started = False
        input_stopped = False
        pcm_frames = 0
        opus_packets = 0
        render_gate_timer: asyncio.TimerHandle | None = None
        render_gate = RenderReplyGate()
        device = request.app[DEVICE]
        stage = "audio_codec_initialize"
        codec = AudioCodec()
        trace = TraceConfig()
        trace.on_request_redirect.append(reject_redirect)
        async with ClientSession(
            timeout=ClientTimeout(total=None, sock_connect=15), trace_configs=[trace]
        ) as client:
            stage = "upstream_websocket_connect"
            upstream = await client.ws_connect(
                device.websocket_url,
                headers=connection_headers(device),
                heartbeat=20,
                max_msg_size=2 * 1024 * 1024,
                autoping=True,
                timeout=ClientWSTimeout(ws_close=1),
            )
            stage = "upstream_hello_send"
            await upstream.send_json(hello_message(device))
            stage = "upstream_hello_wait"
            hello = await asyncio.wait_for(upstream.receive_json(), 12)
            if (
                not isinstance(hello, dict)
                or hello.get("type") != "hello"
                or hello.get("transport") != "websocket"
            ):
                raise ValueError("官方未接受设备握手")
            session_id = hello.get("session_id", "")
            stage = "browser_ready"
            await browser.send_json({"type": "ready", "sample_rate": 24000})
            stage = "active_voice_session"
            pending_stt: str | None = None
            dispatch_lock = asyncio.Lock()
            local_reply_owned = False

            def prepare_render(control: dict) -> None:
                nonlocal render_gate_timer
                request_id = render_request_id(control)
                if request_id is not None:
                    render_gate.begin(request_id)
                    render_gate_timer = asyncio.get_running_loop().call_later(
                        10, render_gate.expire, request_id
                    )

            async def dispatch_completed_input() -> None:
                nonlocal pending_stt, local_reply_owned
                async with dispatch_lock:
                    if (not input_started or not input_stopped or pcm_frames < 3
                            or orchestrator.handled or pending_stt is None):
                        return
                    text, pending_stt = pending_stt, None
                    local_reply_owned = orchestrator.owns_reply(text)
                    if local_reply_owned:
                        # Command acknowledgements come from actual game results,
                        # never the independent cloud guess (“I'll show the bull”).
                        await browser.send_json({"type": "control_policy", "mode": "local"})
                    await browser.send_json({"type": "stt", "text": text})
                    try:
                        await dispatch_local_control(orchestrator, browser, text, prepare_render)
                    except GatewayError as error:
                        await browser.send_json({"type": "control", "result": {
                            "kind": "error", "message": str(error),
                        }})

            async def send_microphone() -> None:
                nonlocal input_started, input_stopped, pcm_frames, opus_packets
                nonlocal render_gate_timer
                nonlocal narration_store, active_narration_id
                async for message in browser:
                    if message.type == WSMsgType.BINARY:
                        if not input_started or input_stopped:
                            raise ValueError("音频不属于当前输入范围")
                        pcm_frames += 1
                        packets = codec.encode(message.data)
                        opus_packets += len(packets)
                        for packet in packets:
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
                            await browser.send_json(
                                {
                                    "type": "uplink_ack",
                                    "event": "start",
                                    "received_frames": 0,
                                    "opus_packets": 0,
                                }
                            )
                        elif op == "text":
                            text = command.get("text")
                            wake_event = fixed_text_event(text, session_id)
                            if input_started and not input_stopped:
                                raise ValueError("固定文本必须是当前会话内不超过80字的完整片段")
                            binding_file = request.app.get(BINDING_FILE)
                            if binding_file is None:
                                raise ValueError("固定讲稿缺少本机MCP讲稿配置")
                            context = await bound.client.get("context")
                            request_id = command.get("request_id") or secrets.token_hex(12)
                            narration_store = NarrationCueStore(cue_path(binding_file))
                            narration_store.stage(bound.client.binding, text, request_id, context)
                            active_narration_id = request_id
                            await browser.send_json({"type": "narration_ack", "request_id": request_id, "stage": "staged"})
                            await upstream.send_json(wake_event)
                        elif op == "stop":
                            input_stopped = True
                            await upstream.send_json(
                                {
                                    "type": "listen",
                                    "state": "stop",
                                    "session_id": session_id,
                                }
                            )
                            await browser.send_json(
                                {
                                    "type": "uplink_ack",
                                    "event": "stop",
                                    "received_frames": pcm_frames,
                                    "opus_packets": opus_packets,
                                }
                            )
                            await dispatch_completed_input()
                        elif op == "abort":
                            await upstream.send_json({"type": "abort", "session_id": session_id})
                            # No reliable cloud per-turn ID was verified. Retire this transport;
                            # a late tts.start on it cannot be promoted to the next local turn.
                            await upstream.close()
                            return
                        elif op == "render_receipt":
                            request_id = command.get("request_id")
                            status = command.get("status")
                            if isinstance(request_id, str):
                                released = render_gate.resolve(request_id, status)
                            else:
                                released = None
                            if released is not None:
                                if render_gate_timer is not None:
                                    render_gate_timer.cancel()
                                    render_gate_timer = None
                                if status == "rendered":
                                    for kind, payload in released:
                                        if kind == "audio":
                                            await browser.send_bytes(payload)  # type: ignore[arg-type]
                                        else:
                                            await browser.send_json(payload)  # type: ignore[arg-type]
                        else:
                            raise ValueError("不支持的语音操作")

            async def receive_reply() -> None:
                nonlocal render_gate_timer
                nonlocal pending_stt
                async for message in upstream:
                    if message.type == WSMsgType.BINARY:
                        if local_reply_owned or (input_started and not orchestrator.handled) or render_gate.drop:
                            continue
                        for pcm in codec.decode(unpack_audio(message.data, device.version)):
                            if not render_gate.hold("audio", pcm, len(pcm)):
                                await browser.send_bytes(pcm)
                            else:
                                continue
                    elif message.type == WSMsgType.TEXT:
                        event = json.loads(message.data)
                        if not isinstance(event, dict):
                            raise ValueError("云端语音事件必须是JSON对象")
                        if event.get("type") == "stt":
                            # Providers can emit final STT just before the local
                            # stop arrives. Keep it until this real PCM turn is
                            # completed; never forward it as an unhandled command.
                            # Text-only synthesis echoes cannot authorize actions.
                            if input_started and not orchestrator.handled:
                                text = event.get("text")
                                if isinstance(text, str) and 0 < len(text.strip()) <= 500:
                                    pending_stt = text.strip()
                                    await dispatch_completed_input()
                            continue
                        if event.get("type") == "tts" and event.get("state") == "start":
                            codec.reset_decoder()
                        if active_narration_id and is_tool_progress(event):
                            await browser.send_json({"type": "narration_ack", "request_id": active_narration_id, "stage": "fetching"})
                            continue
                        if event.get("type") == "alert" and active_narration_id:
                            message = str(event.get("message", ""))
                            code = "wake_word_only" if "Detect is only for wake words" in message else "upstream_narration_rejected"
                            await browser.send_json({"type": "narration_error", "code": code})
                            continue
                        if (local_reply_owned or (input_started and not orchestrator.handled)) and event.get("type") in {"tts", "llm"}:
                            continue
                        if event.get("type") in {"stt", "tts", "llm", "alert", "goodbye"}:
                            safe = {
                                key: event[key] for key in ("type", "state", "text") if key in event
                            }
                            if render_gate.drop and safe["type"] in {"tts", "llm"}:
                                continue
                            if safe["type"] in {"tts", "llm"} and render_gate.hold(
                                "text", safe, len(json.dumps(safe, ensure_ascii=False))
                            ):
                                continue
                            else:
                                await browser.send_json(safe)

            tasks = [asyncio.create_task(send_microphone()), asyncio.create_task(receive_reply())]
            done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                task.result()
    except (ClientError, OSError, ValueError, TimeoutError, FFmpegError, GatewayError) as error:
        # Network exception repr, URL and headers can contain device credentials.
        if browser.prepared and not browser.closed:
            await browser.send_json(bridge_failure(stage, error))
    finally:
        if narration_store is not None and active_narration_id is not None:
            narration_store.retire(active_narration_id)
        if "render_gate_timer" in locals() and render_gate_timer is not None:
            render_gate_timer.cancel()
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


async def entry(request: web.Request) -> web.Response:
    request_origin = request.headers.get("Origin")
    return web.json_response(
        {
            "service": "museum-voice",
            "web_origin": (
                request_origin
                if request_origin in request.app[ORIGINS]
                else request.app[ORIGIN]
            ),
            "web_origins": sorted(request.app[ORIGINS]),
            "device_configured": request.app.get(DEVICE) is not None,
        }
    )


def create_app(
    device: DeviceConfig | None,
    *,
    port: int = 8782,
    origin: str = "http://127.0.0.1:5173",
    web_origins: tuple[str, ...] | None = None,
    binding_file: Path | None = None,
) -> web.Application:
    configured_origins = frozenset(web_origins or (origin,))
    if (
        origin not in SUPPORTED_WEB_ORIGINS
        or origin not in configured_origins
        or not configured_origins.issubset(SUPPORTED_WEB_ORIGINS)
    ):
        raise ValueError("语音桥只允许指定的本机游戏页面")
    app = web.Application(middlewares=[local_only])
    app[DEVICE] = device
    app[ORIGIN] = origin
    app[ORIGINS] = configured_origins
    app[HOST] = f"127.0.0.1:{port}"
    app[ACTIVE] = set()
    app[GAME_BINDINGS] = {}
    if binding_file is not None:
        app[BINDING_FILE] = binding_file
    app.router.add_get("/health", health)
    app.router.add_get("/voice/status", health)
    app.router.add_get("/voice/entry", entry)
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
    configured_origins = tuple(
        item.strip()
        for item in os.environ.get("MUSEUM_WEB_ORIGINS", origin).split(",")
        if item.strip()
    )
    binding_file = os.environ.get("MUSEUM_MCP_BINDING_FILE")
    web.run_app(
        create_app(
            device,
            port=port,
            origin=origin,
            web_origins=configured_origins,
            binding_file=Path(binding_file) if binding_file else None,
        ),
        host="127.0.0.1",
        port=port,
        access_log=None,
        print=None,
    )


if __name__ == "__main__":
    main()
