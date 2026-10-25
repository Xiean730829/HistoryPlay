import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ActiveSession } from "../application/museumApi";
import { StoryFrame } from "./StoryFrame";

const storyId = "cn.tang.story.votive-stele";
const nodeId = "cn.tang.node.votive-stele.01";
const assetId = "cn.tang.asset.votive-stele.story.01";

function renderStory(allowedActions: string[]) {
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
    context: { revision: 4, story_node: node },
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
    expect(markup).toContain("正在读取本段场景图");
    expect(markup).toContain("下一段");
    expect(markup).toContain("返回展廊");
    expect(markup).not.toContain("D:/7/History");
  });

  it("shows only actions permitted by the current node", () => {
    const markup = renderStory(["continue_story"]);

    expect(markup).toContain("下一段");
    expect(markup).not.toContain("返回展廊");
  });
});
