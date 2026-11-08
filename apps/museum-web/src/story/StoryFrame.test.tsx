import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ActiveSession } from "../application/museumApi";
import { StoryFrame } from "./StoryFrame";

const storyId = "cn.tang.story.votive-stele";
const nodeId = "cn.tang.node.votive-stele.01";
const assetId = "cn.tang.asset.votive-stele.story.01";

function renderStory(allowedActions: string[], contextRevision = 4) {
  const node = {
    story_id: storyId,
    node_id: nodeId,
    allowed_actions: allowedActions,
    fact_grade: "C",
    presentation: { capability: "comic", asset_ids: [assetId] },
    available_exits: [],
  };
  const session = {
    session_id: "session-test",
    session_token: "session-token-test",
    version: "0.2.2",
    state: { mode: "story", revision: 4, story_id: storyId, node_id: nodeId },
    context: { revision: contextRevision, story_node: node },
  } as unknown as ActiveSession;

  return renderToStaticMarkup(
    <StoryFrame session={session} busy={false} onContinue={() => {}} onChooseRoute={() => {}} onReturn={() => {}} />,
  );
}

describe("StoryFrame scene pages", () => {
  it("binds the current story node to its first authored image only", () => {
    const markup = renderStory(["continue_story", "return_to_exhibit"]);

    expect(markup).toContain(`data-node-id="${nodeId}"`);
    expect(markup).toContain(`data-asset-id="${assetId}"`);
    expect(markup).toContain("story-bleed");
    expect(markup).not.toContain("story-bleed-main");
    expect(markup).toContain("正在读取本段场景图");
    expect(markup).toContain("下一段");
    expect(markup).toContain("返回展廊");
    expect(markup).not.toContain("D:/7/History");
  });

  it("keeps the session-level return available when the first node only allows continuation", () => {
    const markup = renderStory(["continue_story"]);

    expect(markup).toContain("下一段");
    expect(markup).toContain("返回展廊");
  });

  it("keeps the return available while the committed story page is being synchronized", () => {
    const markup = renderStory(["continue_story"], 3);

    expect(markup).toContain("正在同步已提交的故事段落");
    expect(markup).toContain("返回展廊");
  });

  it("does not render a second story image until the next node is committed", () => {
    const markup = renderStory(["continue_story", "return_to_exhibit"]);
    expect(markup.match(/data-asset-id="/g)).toHaveLength(1);
    expect(markup).toContain(`data-asset-id="${assetId}"`);
    expect(markup).not.toContain("story.02");
  });

  it("keeps honest image-failure copy and never substitutes another exhibit photo", async () => {
    const nodeFs = "node:fs";
    const { readFileSync } = await import(nodeFs);
    const source = readFileSync(new URL("./StoryFrame.tsx", import.meta.url), "utf8") as string;
    expect(source).toContain("本段绑定的场景图当前不可用，没有改用其他文物图片。");
    expect(source).toContain("故事背景不能使用竖图；这张图片已拦截，没有显示。");
    expect(source).toContain("这一段尚未绑定场景图；未用其他展品图片替代。");
  });
});
