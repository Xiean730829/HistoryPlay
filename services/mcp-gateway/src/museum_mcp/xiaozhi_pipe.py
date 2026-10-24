"""Official-compatible JSON-RPC stdio/WSS pipe, without credential-bearing logs."""

from __future__ import annotations

import asyncio
import json
import os
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

from aiohttp import ClientError, ClientSession, ClientTimeout, TraceConfig, WSMsgType


def load_endpoint(path: Path) -> str:
    try:
        endpoint = path.read_text(encoding="utf-8").strip()
        parsed = urlsplit(endpoint)
        if (
            parsed.scheme != "wss"
            or parsed.hostname != "api.xiaozhi.me"
            or parsed.port not in (None, 443)
            or parsed.username
            or parsed.password
            or parsed.fragment
            or not parsed.path.startswith("/mcp/")
            or "\n" in endpoint
            or "\r" in endpoint
        ):
            raise ValueError
        return endpoint
    except (OSError, ValueError):
        raise ValueError("本机MCP接入点文件缺失或不是官方WSS MCP地址") from None


@dataclass
class ProbeEvidence:
    connected: bool = False
    initialize_requests: int = 0
    tools_list_requests: int = 0
    tool_calls: dict[str, int] = field(default_factory=dict)
    audio_verified: bool = False
    abort_verified: bool = False
    turn_association_verified: bool = False

    def observe(self, data: dict) -> None:
        method = data.get("method")
        if method == "initialize":
            self.initialize_requests += 1
        elif method == "tools/list":
            self.tools_list_requests += 1
        elif method == "tools/call":
            name = (data.get("params") or {}).get("name")
            if name in {
                "museum_probe",
                "museum_probe_sentence",
                "museum_get_context",
                "museum_search",
                "museum_read_content",
            }:
                self.tool_calls[name] = self.tool_calls.get(name, 0) + 1

    def write(self, path: Path | None) -> None:
        if path is None:
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        temp = path.with_suffix(path.suffix + ".tmp")
        temp.write_text(json.dumps(asdict(self), ensure_ascii=False, indent=2), encoding="utf-8")
        temp.replace(path)


async def reject_redirect(*args) -> None:
    raise ValueError("MCP接入点不允许重定向")


async def relay(websocket, process, evidence: ProbeEvidence, report: Path | None) -> None:
    async def cloud_to_stdio():
        async for message in websocket:
            if message.type not in (WSMsgType.TEXT, WSMsgType.BINARY):
                continue
            raw = message.data.encode("utf-8") if isinstance(message.data, str) else message.data
            if len(raw) > 65536:
                raise ValueError("MCP消息超过预算")
            value = json.loads(raw)
            if not isinstance(value, dict) or value.get("jsonrpc") != "2.0":
                raise ValueError("MCP消息格式不正确")
            evidence.observe(value)
            evidence.write(report)
            process.stdin.write(json.dumps(value, ensure_ascii=False).encode("utf-8") + b"\n")
            await process.stdin.drain()

    async def stdio_to_cloud():
        while line := await process.stdout.readline():
            if len(line) > 65536:
                raise ValueError("MCP响应超过预算")
            value = json.loads(line)
            if not isinstance(value, dict):
                raise TypeError("MCP响应格式不正确")
            await websocket.send_str(line.decode("utf-8").strip())

    tasks = [asyncio.create_task(cloud_to_stdio()), asyncio.create_task(stdio_to_cloud())]
    try:
        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in done:
            task.result()
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


async def connect_once(
    endpoint: str, mode: str, evidence: ProbeEvidence, report: Path | None
) -> None:
    modules = {"probe": "museum_mcp.probe_server", "museum": "museum_mcp.server"}
    if mode not in modules:
        raise ValueError("MCP模式只能是probe或museum")
    trace = TraceConfig()
    trace.on_request_redirect.append(reject_redirect)
    async with (
        ClientSession(
            timeout=ClientTimeout(total=None, sock_connect=15), trace_configs=[trace]
        ) as client,
        client.ws_connect(endpoint, heartbeat=20, max_msg_size=65536) as websocket,
    ):
        evidence.connected = True
        evidence.write(report)
        print("小智MCP管道已连接；等待云端发现工具。", file=sys.stderr)
        process = await asyncio.create_subprocess_exec(
            sys.executable,
            "-m",
            modules[mode],
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
            limit=65536,
        )
        try:
            await relay(websocket, process, evidence, report)
        finally:
            if process.returncode is None:
                process.terminate()
                try:
                    await asyncio.wait_for(process.wait(), 5)
                except TimeoutError:
                    process.kill()
                    await process.wait()
            evidence.connected = False
            evidence.write(report)


def main() -> None:
    file = os.environ.get("MUSEUM_MCP_ENDPOINT_FILE")
    if not file:
        raise SystemExit("请设置MUSEUM_MCP_ENDPOINT_FILE指向本机私密MCP接入点文本文件")
    try:
        endpoint = load_endpoint(Path(file))
    except ValueError as error:
        raise SystemExit(str(error)) from None
    mode = os.environ.get("MUSEUM_MCP_MODE", "probe")
    report_file = os.environ.get("MUSEUM_MCP_REPORT_FILE")
    report = Path(report_file) if report_file else None

    async def run():
        evidence = ProbeEvidence()
        delay = 1
        while True:
            try:
                await connect_once(endpoint, mode, evidence, report)
                delay = 1
            except (ClientError, OSError, ValueError, TypeError, RuntimeError, TimeoutError):
                print("MCP管道未连接或已断开，将重试；未记录接入点与令牌。", file=sys.stderr)
            await asyncio.sleep(delay)
            delay = min(delay * 2, 30)

    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
