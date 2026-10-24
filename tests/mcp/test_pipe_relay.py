from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
from types import SimpleNamespace

from aiohttp import WSMsgType

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "services/mcp-gateway/src"))

from museum_mcp.xiaozhi_pipe import ProbeEvidence, relay


def test_actual_stdio_process_through_pipe_discovers_and_calls_diagnostic_tool(tmp_path):
    async def run():
        finished = asyncio.Event()
        responses = []

        class FakeCloud:
            def __aiter__(self):
                async def incoming():
                    messages = [
                        {
                            "jsonrpc": "2.0",
                            "id": 1,
                            "method": "initialize",
                            "params": {
                                "protocolVersion": "2024-11-05",
                                "capabilities": {},
                                "clientInfo": {"name": "pipe-test", "version": "1"},
                            },
                        },
                        {"jsonrpc": "2.0", "method": "notifications/initialized"},
                        {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}},
                        {
                            "jsonrpc": "2.0",
                            "id": 3,
                            "method": "tools/call",
                            "params": {
                                "name": "museum_probe",
                                "arguments": {},
                            },
                        },
                    ]
                    for value in messages:
                        yield SimpleNamespace(type=WSMsgType.TEXT, data=json.dumps(value))
                    await finished.wait()

                return incoming()

            async def send_str(self, value):
                response = json.loads(value)
                responses.append(response)
                if response.get("id") == 3:
                    finished.set()

        process = await asyncio.create_subprocess_exec(
            sys.executable,
            "-m",
            "museum_mcp.probe_server",
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        evidence = ProbeEvidence()
        try:
            await asyncio.wait_for(
                relay(FakeCloud(), process, evidence, tmp_path / "report.json"), 10
            )
            by_id = {item["id"]: item for item in responses if "id" in item}
            assert "result" in by_id[1]
            assert len(by_id[2]["result"]["tools"]) == 2
            assert by_id[3]["result"]["isError"] is False
            assert evidence.tools_list_requests == 1
            assert evidence.tool_calls == {"museum_probe": 1}
            assert evidence.turn_association_verified is False
        finally:
            process.terminate()
            await process.wait()

    asyncio.run(run())
