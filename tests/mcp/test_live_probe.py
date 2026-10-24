from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "services/mcp-gateway/src"))

from museum_mcp.probe_server import SENTENCE, create_probe
from museum_mcp.xiaozhi_pipe import ProbeEvidence, load_endpoint


def test_probe_discovery_does_not_require_game_binding_or_claim_audio_success():
    async def run():
        server = create_probe()
        discovered = await server.list_tools()
        assert {item.name for item in discovered} == {"museum_probe", "museum_probe_sentence"}
        result = await server.call_tool("museum_probe_sentence", {})
        assert SENTENCE in str(result)
        assert "False" in str(result) or "false" in str(result)

    asyncio.run(run())


def test_evidence_contains_only_method_counts_not_tokens_text_or_caller_turn_claim(tmp_path):
    evidence = ProbeEvidence()
    evidence.observe({"method": "initialize"})
    evidence.observe({"method": "tools/list"})
    evidence.observe(
        {
            "method": "tools/call",
            "params": {
                "name": "museum_probe",
                "arguments": {"token": "private-test-token", "text": "private-dialogue"},
            },
        }
    )
    report = tmp_path / "report.json"
    evidence.write(report)
    raw = report.read_text(encoding="utf-8")
    assert "private" not in raw
    data = json.loads(raw)
    assert data["tool_calls"] == {"museum_probe": 1}
    assert data["turn_association_verified"] is False
    assert data["audio_verified"] is False


@pytest.mark.parametrize(
    "url",
    [
        "ws://api.xiaozhi.me/mcp/?token=x",
        "wss://evil.invalid/mcp/?token=x",
        "wss://user:secret@api.xiaozhi.me/mcp/",
        "wss://api.xiaozhi.me/device/",
    ],
)
def test_endpoint_rejects_nonofficial_or_nonmcp_destination_without_echoing_token(tmp_path, url):
    file = tmp_path / "endpoint.txt"
    file.write_text(url, encoding="utf-8")
    with pytest.raises(ValueError) as error:
        load_endpoint(file)
    assert "token=x" not in str(error.value)
