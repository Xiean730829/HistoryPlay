from __future__ import annotations

import json
import struct
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "services/voice-bridge/src"))

from museum_voice.codec import AudioCodec, pack_audio, unpack_audio
from museum_voice.config import DeviceConfig
from museum_voice.xiaozhi_client import connection_headers, hello_message


def device(**overrides):
    return DeviceConfig(
        **{
            "device_id": "aa:bb:cc:dd:ee:ff",
            "client_id": "4032ca38-fd23-4844-9f8a-e97035b0838c",
            "websocket_url": "wss://api.xiaozhi.me/v1/",
            "token": "private-test-token",
            **overrides,
        }
    )


@pytest.mark.parametrize(
    "url",
    [
        "ws://api.xiaozhi.me/v1/",
        "wss://evil.invalid/",
        "wss://user:pass@api.xiaozhi.me/v1/",
        "wss://api.xiaozhi.me:444/v1/",
    ],
)
def test_fixed_device_rejects_unapproved_credential_destinations(url):
    with pytest.raises(ValueError):
        device(websocket_url=url)


def test_fixed_identity_persists_and_config_repr_hides_secrets(tmp_path):
    config = device()
    path = tmp_path / "device.json"
    path.write_text(
        json.dumps(
            {
                "device_id": config.device_id,
                "client_id": config.client_id,
                "websocket": {"url": config.websocket_url, "token": config.token, "version": 1},
            }
        ),
        encoding="utf-8",
    )
    assert DeviceConfig.load(path) == config
    assert DeviceConfig.load(path) == config
    assert "private-test-token" not in repr(config)
    assert config.device_id not in repr(config)
    assert connection_headers(config)["Device-Id"] == config.device_id
    assert hello_message(config)["features"] == {}


@pytest.mark.parametrize("version", [1, 2, 3])
def test_binary_protocol_roundtrip_and_length_rejection(version):
    payload = b"test-opus"
    assert unpack_audio(pack_audio(payload, version), version) == payload
    if version != 1:
        with pytest.raises(ValueError):
            unpack_audio(pack_audio(payload, version)[:-1], version)


def test_real_opus_codec_accumulates_20ms_and_decodes_audio():
    codec = AudioCodec()
    frame = struct.pack("<320h", *([1000, -1000] * 160))
    assert codec.encode(frame) == []
    assert codec.encode(frame) == []
    packets = codec.encode(frame)
    assert packets
    decoded = [pcm for packet in packets for pcm in codec.decode(packet)]
    assert decoded
    assert all(struct.unpack("!I", pcm[:4])[0] == 24000 for pcm in decoded)
    assert sum(len(pcm) - 4 for pcm in decoded) > 0
    with pytest.raises(ValueError):
        codec.encode(b"not-20ms")
