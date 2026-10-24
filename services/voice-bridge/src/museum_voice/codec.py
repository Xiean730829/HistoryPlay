from __future__ import annotations

import struct
from fractions import Fraction

import av


def pack_audio(payload: bytes, version: int) -> bytes:
    if version == 1:
        return payload
    if version == 2:
        return struct.pack("!HHIII", 2, 0, 0, 0, len(payload)) + payload
    if version == 3:
        return struct.pack("!BBH", 0, 0, len(payload)) + payload
    raise ValueError("不支持的音频协议版本")


def unpack_audio(packet: bytes, version: int) -> bytes:
    if version not in (1, 2, 3):
        raise ValueError("不支持的音频协议版本")
    offset = {1: 0, 2: 16, 3: 4}[version]
    if len(packet) < offset:
        raise ValueError("音频包头不完整")
    if version == 2:
        if struct.unpack("!H", packet[:2])[0] != 2:
            raise ValueError("音频版本不匹配")
        length = struct.unpack("!I", packet[12:16])[0]
    elif version == 3:
        length = struct.unpack("!H", packet[2:4])[0]
    else:
        length = len(packet)
    if length != len(packet) - offset:
        raise ValueError("音频包长度不符")
    return packet[offset:]


class AudioCodec:
    """Accumulates three 20ms browser frames into each 60ms Opus packet."""

    def __init__(self) -> None:
        self.encoder = av.CodecContext.create("libopus", "w")
        self.encoder.sample_rate = 16000
        self.encoder.layout = "mono"
        self.encoder.format = "s16"
        self.encoder.bit_rate = 24000
        self.encoder.time_base = Fraction(1, 16000)
        self.encoder.options = {"frame_duration": "60", "application": "voip"}
        self.decoder = av.CodecContext.create("opus", "r")
        self.resampler = av.AudioResampler(format="s16", layout="mono", rate=24000)
        self.pending = bytearray()
        self.pts = 0

    def encode(self, pcm20ms: bytes) -> list[bytes]:
        if len(pcm20ms) != 640:
            raise ValueError("浏览器音频须为16kHz单声道PCM16的20ms帧")
        self.pending.extend(pcm20ms)
        packets = []
        while len(self.pending) >= 1920:
            frame = av.AudioFrame(format="s16", layout="mono", samples=960)
            frame.sample_rate = 16000
            frame.time_base = Fraction(1, 16000)
            frame.pts = self.pts
            self.pts += 960
            frame.planes[0].update(bytes(self.pending[:1920]))
            del self.pending[:1920]
            packets.extend(bytes(packet) for packet in self.encoder.encode(frame))
        return packets

    def decode(self, packet: bytes):
        for frame in self.decoder.decode(av.Packet(packet)):
            for pcm in self.resampler.resample(frame):
                # Browser packet: uint32 big-endian sample rate, then little-endian PCM16.
                yield struct.pack("!I", 24000) + bytes(pcm.planes[0])[: pcm.samples * 2]
