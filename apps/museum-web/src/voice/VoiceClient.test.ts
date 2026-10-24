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
  it("重连保留最近240ms预录，20ms帧顺序不变且显式关闭清空", async () => {
    const { client } = fixture();
    const opening = client.connect();
    const old = FakeSocket.sockets[0];
    old.onmessage?.({ data: JSON.stringify({ type: "ready" }) }); await opening;
    for (let i = 0; i < 14; i++) client.sendFrame(new Uint8Array(640).fill(i).buffer);
    client.interrupt();
    const next = client.connect();
    const socket = FakeSocket.sockets[1];
    socket.onmessage?.({ data: JSON.stringify({ type: "ready" }) }); await next;
    client.startListening();
    const frames = socket.send.mock.calls.map(([item]) => item).filter((item) => typeof item !== "string");
    expect(frames).toHaveLength(12);
    expect(frames.map((item) => new Uint8Array(item as ArrayBuffer)[0])).toEqual([2,3,4,5,6,7,8,9,10,11,12,13]);
    client.disconnect();
  });
  it("用户说完早于ready时完整缓存本轮，连接后按start/音频/stop提交", async () => {
    const { client } = fixture();
    for (let i = 0; i < 6; i++) client.sendFrame(new Uint8Array(640).fill(i).buffer);
    const opening = client.beginTurn();
    for (let i = 6; i < 56; i++) client.sendFrame(new Uint8Array(640).fill(i).buffer);
    client.endTurn();
    // Silence after the input ended must not extend the buffered utterance.
    for (let i = 0; i < 20; i++) client.sendFrame(new ArrayBuffer(640));
    await Promise.resolve();
    const socket = FakeSocket.sockets[0];
    socket.onmessage?.({ data: JSON.stringify({ type: "ready" }) }); await opening;
    const payloads = socket.send.mock.calls.map(([item]) => item);
    expect(JSON.parse(payloads[0] as string).op).toBe("start");
    expect(JSON.parse(payloads.at(-1) as string).op).toBe("stop");
    const frames = payloads.filter((item) => typeof item !== "string");
    expect(frames).toHaveLength(56);
    expect(new Uint8Array(frames[0] as ArrayBuffer)[0]).toBe(0);
    expect(new Uint8Array(frames.at(-1) as ArrayBuffer)[0]).toBe(55);
    client.disconnect();
  });
});
