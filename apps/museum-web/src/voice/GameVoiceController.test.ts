import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActiveSession } from "../application/museumApi";
import type { CommandReceipt } from "@history-play/contracts";
import { NarrationPlayer } from "../narration/NarrationPlayer";
import { GameVoiceController } from "./GameVoiceController";
import type { VoiceControlResult } from "./VoiceClient";

afterEach(() => vi.restoreAllMocks());

describe("语音控制与画面刷新竞态", () => {
  it("刷新等待期间出现新问题，旧动作完成不能迟到开始朗读", async () => {
    const play = vi.spyOn(NarrationPlayer.prototype, "play").mockResolvedValue(true);
    let release!: () => void;
    const controller = new GameVoiceController({} as ActiveSession, {
      onStatus: vi.fn(), onTranscript: vi.fn(),
      onRefresh: () => new Promise<void>((resolve) => { release = resolve; }),
    });
    const handler = controller as unknown as { control(result: VoiceControlResult): Promise<void> };
    const pending = handler.control({ kind: "action",
      receipt: { action: "enter_story" } as CommandReceipt,
      narration: { packId: "cn.tang.core", version: "1", contentId: "old-node", text: "旧正文" },
    });
    controller.beginTurn();
    release();
    await pending;
    expect(play).not.toHaveBeenCalled();
    controller.dispose();
  });
});
