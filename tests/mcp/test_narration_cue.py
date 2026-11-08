import pytest
from museum_mcp.application_client import BoundSession, GatewayError
from museum_mcp.narration_cue import NarrationCueStore

BINDING = BoundSession("http://127.0.0.1:8793", "session", "private-token", "connection")
CONTEXT = {"revision": 3, "focused_artifact": {"id": "coin"}, "story_node": {"node_id": "coin.01"}}


def test_stage_is_fixed_text_data_and_does_not_expose_credentials(tmp_path):
    path = tmp_path / "cue.json"
    store = NarrationCueStore(path)
    store.stage(BINDING, "请重复下面这句话：唐代铜钱。", "request-1", CONTEXT)
    assert store.read(BINDING, CONTEXT)["prepared_text"] == "唐代铜钱。"
    assert "private-token" not in path.read_text(encoding="utf-8")


@pytest.mark.parametrize("context", [
    {**CONTEXT, "revision": 4},
    {**CONTEXT, "focused_artifact": {"id": "bull"}},
    {**CONTEXT, "story_node": {"node_id": "coin.02"}},
])
def test_changed_frame_cannot_read_the_old_script(tmp_path, context):
    store = NarrationCueStore(tmp_path / "cue.json")
    store.stage(BINDING, "请逐字朗读：当前段落。", "request-1", CONTEXT)
    with pytest.raises(GatewayError, match="画面已变化"):
        store.read(BINDING, context)


def test_repairing_another_page_cannot_read_previous_script(tmp_path):
    store = NarrationCueStore(tmp_path / "cue.json")
    store.stage(BINDING, "请逐字朗读：当前段落。", "request-1", CONTEXT)
    other = BoundSession(BINDING.base_url, BINDING.session_id, BINDING.session_token, "new-connection")
    with pytest.raises(GatewayError):
        store.read(other, CONTEXT)


def test_late_close_does_not_retire_newer_script_but_current_close_does(tmp_path):
    store = NarrationCueStore(tmp_path / "cue.json")
    store.stage(BINDING, "请逐字朗读：第一段。", "old", CONTEXT)
    store.stage(BINDING, "请逐字朗读：第二段。", "new", CONTEXT)
    store.retire("old")
    assert store.read(BINDING, CONTEXT)["prepared_text"] == "第二段。"
    store.retire("new")
    with pytest.raises(GatewayError):
        store.read(BINDING, CONTEXT)
