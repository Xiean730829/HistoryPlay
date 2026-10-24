import type { ActiveSession } from "../application/museumApi";
import { StoryFrame } from "./StoryFrame";

interface ArtifactStoryStageProps {
  session: ActiveSession;
  busy: boolean;
  onContinue: () => void;
  onReturn: () => void;
}

/** Mounts a story layer only while its committed node belongs to the anchored exhibit. */
export function ArtifactStoryStage(props: ArtifactStoryStageProps) {
  const { session } = props;
  const node = session.context.story_node;
  const anchor = session.context.focused_artifact;
  if (session.context.revision !== session.state.revision || !node) {
    return (
      <section className="story-stage" aria-label="故事场景" role="status">
        正在同步已提交的故事段落…
        <button className="button button-quiet" disabled={props.busy} onClick={props.onReturn} type="button">
          返回原展台
        </button>
      </section>
    );
  }
  const belongsToAnchor = Boolean(anchor && node && anchor.story_entry_ids?.includes(node.story_id));
  if (!belongsToAnchor) {
    return (
      <section className="story-stage" aria-label="故事场景" role="status">
        当前发布版本没有提供与这件文物绑定的故事段落。返回原展台，文物位置不会改变。
        <button className="button button-quiet" disabled={props.busy} onClick={props.onReturn} type="button">
          返回原展台
        </button>
      </section>
    );
  }
  return <StoryFrame {...props} />;
}
