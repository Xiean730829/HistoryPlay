import { afterEach, describe, expect, it, vi } from "vitest";
import { VoiceClient } from "./VoiceClient";
import type { PlaybackQueue } from "./PlaybackQueue";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

class FakeSocket {
  static sockets: FakeSocket[] = [];
  binaryType = "";
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => this.onclose?.());
  constructor() { FakeSocket.sockets.push(this); }
}

function fixture() {
  FakeSocket.sockets = [];
  vi.stubGlobal("WebSocket", FakeSocket);
  const playback = { epoch: 0, stop: vi.fn(() => { playback.epoch += 1; }), enqueue: vi.fn() };
  const callbacks = { onState: vi.fn(), onText: vi.fn() };
  return { client: new VoiceClient(playback as unknown as PlaybackQueue, callbacks), playback, callbacks };
}

describe("受控语音客户端", () => {
  it("只有ready才表示已连接，发送20ms音频且不发送设备凭据", async () => {
    const { client, callbacks } = fixture();
    const opening = client.connect();
    const socket = FakeSocket.sockets[0];
    expect(callbacks.onState).toHaveBeenLastCalledWith("connecting");
    socket.onmessage?.({ data: JSON.stringify({ type: "ready" }) });
    await opening;
    client.startListening();
    client.sendFrame(new ArrayBuffer(640));
    client.stopListening();
    expect(socket.send.mock.calls.map(([item]) => typeof item)).toEqual(["string", "object", "string"]);
    expect(JSON.stringify(socket.send.mock.calls)).not.toContain("token");
    client.disconnect();
  });
  it("插话先本地stop，旧连接晚到音频与文本不进入新连接", async () => {
    const { client, playback, callbacks } = fixture();
    const opening = client.connect();
    const old = FakeSocket.sockets[0];
    old.onmessage?.({ data: JSON.stringify({ type: "ready" }) }); await opening;
    const delayed = old.onmessage;
    client.interrupt();
    expect(playback.stop.mock.invocationCallOrder.at(-2)).toBeLessThan(old.send.mock.invocationCallOrder[0]);
    const next = client.connect();
    const socket = FakeSocket.sockets[1];
    socket.onmessage?.({ data: JSON.stringify({ type: "ready" }) }); await next;
    delayed?.({ data: JSON.stringify({ type: "stt", text: "旧问题" }) });
    delayed?.({ data: new ArrayBuffer(644) });
    expect(callbacks.onText).not.toHaveBeenCalled();
    expect(playback.enqueue).not.toHaveBeenCalled();
    client.disconnect();
  });
});
