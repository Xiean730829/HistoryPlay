import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActiveSession } from "../application/museumApi";
import { EventChannel } from "./eventChannel";

class FakeSocket {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  close = vi.fn(() => this.onclose?.({} as CloseEvent));
}

describe("EventChannel", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("uses the one-time ticket as a subprotocol and resumes from after_seq on reconnect", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { location: { href: "https://museum.example/" } });
    const sockets: FakeSocket[] = [];
    const connections: Array<{ url: string; protocols: string[] }> = [];
    let ticket = 0;
    const onEvent = vi.fn();
    const session = { session_id: "session-1" } as ActiveSession;
    const channel = new EventChannel({
      session,
      getCursor: () => 7,
      requestTicket: async () => ({ ticket: `short-${++ticket}` }),
      onEvent,
      onSnapshot: vi.fn(),
      reconnectDelayMs: 10,
      socketFactory: (url, protocols) => {
        connections.push({ url, protocols });
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
    });

    channel.start();
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    const frame = { type: "event", event: { session_id: "session-1", event_seq: 8, kind: "focus_changed", revision: 8, interaction_epoch: 1 } };
    sockets[0].onmessage?.({ data: JSON.stringify(frame) } as MessageEvent);
    expect(onEvent).toHaveBeenCalledWith(frame.event);
    expect(new URL(connections[0].url).searchParams.get("after_seq")).toBe("7");
    expect(connections[0].url).not.toContain("short-1");
    expect(connections[0].protocols).toEqual(["museum-events.v1", "museum-ticket.short-1"]);

    sockets[0].onclose?.({} as CloseEvent);
    await vi.advanceTimersByTimeAsync(10);
    await vi.waitFor(() => expect(sockets).toHaveLength(2));
    expect(connections[1].protocols[1]).toBe("museum-ticket.short-2");
    expect(new URL(connections[1].url).searchParams.get("after_seq")).toBe("7");
    channel.stop();
  });
});
