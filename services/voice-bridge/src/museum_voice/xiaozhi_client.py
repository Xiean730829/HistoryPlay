from __future__ import annotations

from museum_voice.config import DeviceConfig


def connection_headers(device: DeviceConfig) -> dict[str, str]:
    token = device.token if " " in device.token else f"Bearer {device.token}"
    return {
        "Authorization": token,
        "Device-Id": device.device_id,
        "Client-Id": device.client_id,
        "Protocol-Version": str(device.version),
    }


def hello_message(device: DeviceConfig) -> dict:
    return {
        "type": "hello",
        "version": device.version,
        "transport": "websocket",
        "features": {},
        "audio_params": {
            "format": "opus",
            "sample_rate": 16000,
            "channels": 1,
            "frame_duration": 60,
        },
    }
