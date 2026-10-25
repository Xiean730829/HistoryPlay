import { afterEach, describe, expect, it, vi } from "vitest";
import { VoiceClient } from "./VoiceClient";
import type { PlaybackQueue } from "./PlaybackQueue";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

class FakeSocket {
  static sockets: FakeSocket[] = [];
  binaryType = "";
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onopen: (() => void) | null = null;
  onclose: ((event?: { code?: number }) => void) | null = null;
  onerror: ((event?: unknown) => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => this.onclose?.({ code: 1000 }));
  constructor() { FakeSocket.sockets.push(this); }
}

function fixture() {
  FakeSocket.sockets = [];
  vi.stubGlobal("WebSocket", FakeSocket);
  const playback = { epoch: 0, stop: vi.fn(() => { playback.epoch += 1; }), enqueue: vi.fn(() => true), onDrained: vi.fn((_epoch: number, callback: () => void) => callback()) };
  const callbacks = { onState: vi.fn(), onText: vi.fn() };
  return { client: new VoiceClient(playback as unknown as PlaybackQueue, callbacks), playback, callbacks };
}

describe("受控语音客户端", () => {
  it("显示本机WebSocket代理和脱敏桥接阶段，不泄露绑定信息", async () => {
    const { playback, callbacks } = fixture();
    const client = new VoiceClient(
      playback as unknown as PlaybackQueue,
      callbacks,
      "ws://127.0.0.1:5190/voice/ws",
      "private-binding-id",
    );
    const opening = client.connect();
    const socket = FakeSocket.sockets[0];
    socket.onopen?.();

    expect(socket.send).toHaveBeenCalledOnce();
    expect(callbacks.onState).toHaveBeenLastCalledWith(
      "connecting", "展台绑定已发送，正在等待讲解员就绪",
    );
    expect(callbacks.onState.mock.calls.flat().join(" ")).toContain("ws://127.0.0.1:5190/voice/ws");
    expect(callbacks.onState.mock.calls.flat().join(" ")).not.toContain("private-binding-id");

    socket.onmessage?.({ data: JSON.stringify({
      type: "bridge_error", stage: "upstream_websocket_connect", code: "upstream_http_401",
    }) });
    await expect(opening).rejects.toThrow("讲解员服务连接（upstream_http_401）");
    expect(callbacks.onState).toHaveBeenLastCalledWith(
      "error", "语音连接失败：讲解员服务连接（upstream_http_401）",
    );
    client.disconnect();
  });

  it("区分升级超时与桥接就绪超时并报告标准关闭码", async () => {
    vi.useFakeTimers();
    const { playback, callbacks } = fixture();
    const client = new VoiceClient(
      playback as unknown as PlaybackQueue,
      callbacks,
      "ws://127.0.0.1:8782/voice/ws",
      "local-binding",
    );
    const opening = client.connect();
    const socket = FakeSocket.sockets[0];
    const rejected = expect(opening).rejects.toThrow("浏览器WebSocket代理（closed_1006）");
    socket.onclose?.({ code: 1006 });
    await rejected;

    const secondOpening = client.connect();
    const secondSocket = FakeSocket.sockets[1];
    secondSocket.onopen?.();
    const timeout = expect(secondOpening).rejects.toThrow("本机语音桥就绪（ready_timeout）");
    await vi.advanceTimersByTimeAsync(30000);
    await timeout;
  });

  it("只有ready才表示已连接，发送20ms音频且不发送设备凭据", async () => {
    const { client, callbacks } = fixture();
    const opening = client.connect();
    const socket = FakeSocket.sockets[0];
    expect(callbacks.onState).toHaveBeenLastCalledWith(
      "connecting", "正在连接本机语音桥：ws://127.0.0.1:8782/voice/ws",
    );
    socket.onmessage?.({ data: JSON.stringify({ type: "ready" }) });
    await opening;
    client.startListening();
    client.sendFrame(new ArrayBuffer(640));
    client.stopListening();
    expect(socket.send.mock.calls.map(([item]) => typeof item)).toEqual(["string", "object", "string"]);
    expect(JSON.stringify(socket.send.mock.calls)).not.toContain("token");
    client.disconnect();
  });
  it("固定稿只有收到匹配字幕、真实音频帧和播放停止后才完成", async () => {
    const { client, playback } = fixture();
    const opening = client.connect();
    const socket = FakeSocket.sockets[0];
    socket.onmessage?.({ data: JSON.stringify({ type: "ready" }) }); await opening;
    const started = vi.fn();
    const signal = new AbortController().signal;
    const narration = client.speakFixedText("请逐字朗读：唐代鎏金铜牛。", "唐代鎏金铜牛。", signal, started);
    await Promise.resolve();
    expect(JSON.parse(socket.send.mock.calls.at(-1)?.[0] as string)).toEqual({
      op: "text", text: "请逐字朗读：唐代鎏金铜牛。",
    });
    let settled = false; void narration.then(() => { settled = true; });
    socket.onmessage?.({ data: JSON.stringify({ type: "tts", state: "start" }) });
    socket.onmessage?.({ data: JSON.stringify({ type: "tts", state: "sentence_start", text: "唐代鎏金铜牛。" }) });
    socket.onmessage?.({ data: new ArrayBuffer(644) });
    socket.onmessage?.({ data: JSON.stringify({ type: "tts", state: "stop" }) });
    await narration;
    expect(started).toHaveBeenCalledOnce();
    expect(playback.onDrained).toHaveBeenCalledOnce();
    expect(settled).toBe(true);
    client.disconnect();
  });
  it("小智改写固定字幕时拒绝完成，不能授权故事自动翻页", async () => {
    const { client } = fixture();
    const opening = client.connect();
    const socket = FakeSocket.sockets[0];
    socket.onmessage?.({ data: JSON.stringify({ type: "ready" }) }); await opening;
    const narration = client.speakFixedText("请逐字朗读：固定正文", "固定正文", new AbortController().signal, vi.fn());
    await Promise.resolve();
    socket.onmessage?.({ data: JSON.stringify({ type: "tts", state: "start" }) });
    socket.onmessage?.({ data: JSON.stringify({ type: "tts", state: "sentence_start", text: "小智改写了正文" }) });
    socket.onmessage?.({ data: new ArrayBuffer(644) });
    socket.onmessage?.({ data: JSON.stringify({ type: "tts", state: "stop" }) });
    await expect(narration).rejects.toThrow("字幕与固定正文不一致");
  });
  it("无效音频帧不计为真实播放完成", async () => {
    const { client, playback } = fixture();
    const opening = client.connect();
    const socket = FakeSocket.sockets[0];
    socket.onmessage?.({ data: JSON.stringify({ type: "ready" }) }); await opening;
    playback.enqueue.mockReturnValue(false);
    const narration = client.speakFixedText("请逐字朗读：固定正文", "固定正文", new AbortController().signal, vi.fn());
    await Promise.resolve();
    socket.onmessage?.({ data: JSON.stringify({ type: "tts", state: "start" }) });
    socket.onmessage?.({ data: JSON.stringify({ type: "tts", state: "sentence_start", text: "固定正文" }) });
    socket.onmessage?.({ data: new ArrayBuffer(644) });
    socket.onmessage?.({ data: JSON.stringify({ type: "tts", state: "stop" }) });
    await expect(narration).rejects.toThrow("未返回完整本段音频");
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
