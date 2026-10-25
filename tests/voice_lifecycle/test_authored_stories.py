from pathlib import Path

from content_pipeline.build.compiler import compile_pack
from museum.application.story_content import load_story
from museum.domain.session.models import SessionMode, SessionState
from museum.domain.session.transitions import return_to_exhibit
from museum.domain.story.engine import advance_story, available_exits, start_story
from museum.domain.story.models import ExitAction
from museum.ports.content_catalog import PublishedPack


def test_three_real_authored_stories_enter_advance_and_return_to_same_exhibit():
    root = Path(__file__).resolve().parents[2]
    issues, documents = compile_pack(root / "content-src/packs/cn-tang")
    assert issues == [] and documents is not None
    pack = PublishedPack("cn.tang.core", "0.2.0", "1", documents)
    for name in ("votive-stele", "kaiyuan-coin", "gilt-bronze-bull"):
        artifact = f"cn.tang.artifact.{name}"
        original = SessionState(
            session_id="authored-story",
            pack_versions={"cn.tang.core": "0.2.0"},
            mode=SessionMode.EXPLORE,
            focused_entity_id=artifact,
            visible_entities=(artifact,),
            gallery_id="cn.tang.gallery.main",
            station_id=f"cn.tang.station.{name}",
        )
        story = load_story(
            (pack,),
            f"cn.tang.story.{name}",
            lambda packs, document_id, directory: next(
                document
                for item in packs
                for path, document in item.documents.items()
                if path.startswith(directory) and document.get("id") == document_id
            ),
        )
        entered = start_story(original, story)
        assert entered.state.node_id == f"cn.tang.node.{name}.01"
        advanced = advance_story(entered.state, story, ExitAction.CONTINUE_STORY)
        assert advanced.state.node_id == f"cn.tang.node.{name}.02"
        assert available_exits(advanced.state, story) == ()
        returned = return_to_exhibit(advanced.state).state
        assert returned.mode == SessionMode.EXPLORE
        assert returned.focused_entity_id == original.focused_entity_id
        assert returned.station_id == original.station_id
        assert returned.camera_pose == original.camera_pose
