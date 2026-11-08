import { describe, expect, it } from "vitest";
import { ConversationCoordinator } from "./ConversationCoordinator";

describe("ConversationCoordinator", () => {
  it("保存多候选并按第二个或短名选中同一件", () => {
    const coordinator = new ConversationCoordinator();
    coordinator.remember({
      kind: "clarification",
      diagnosis: {
        intent: "locate",
        query: "乐俑",
        candidates: 2,
        candidate_ids: ["cn.tang.artifact.lute-musician", "cn.tang.artifact.flute-musician"],
        candidate_titles: ["弹拨乐俑", "吹笛乐俑"],
      },
    });
    expect(coordinator.resolveFollowUp("第二个")?.id).toBe("cn.tang.artifact.flute-musician");
    expect(coordinator.resolveFollowUp("吹笛的")?.id).toBe("cn.tang.artifact.flute-musician");
    expect(coordinator.lastQuery()).toBe("乐俑");
  });
  it("完整指令不被旧候选表拦截，也不会把一佛二菩萨误当第一件", () => {
    const coordinator = new ConversationCoordinator();
    coordinator.setCandidates([
      { id: "lute", title: "弹拨乐俑", order: 0, purpose: "locate" },
      { id: "flute", title: "吹笛乐俑", order: 1, purpose: "locate" },
    ]);
    expect(coordinator.resolveFollowUp("带我看吹笛乐俑")).toBeNull();
    expect(coordinator.resolveFollowUp("一佛二菩萨造像碑")).toBeNull();
    expect(coordinator.resolveFollowUp("吹笛乐俑是什么年代的")).toBeNull();
    expect(coordinator.resolveFollowUp("我选第二个")?.id).toBe("flute");
    coordinator.clear();
    expect(coordinator.resolveFollowUp("第二个")).toBeNull();
  });
});
