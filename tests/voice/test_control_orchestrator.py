import asyncio

import pytest
from museum_mcp.action_tools import TrustedInput
from museum_mcp.application_client import GatewayError
from museum_voice.control_orchestrator import InputOrchestrator, SpokenSelection


class Client:
    def __init__(self, *, mode=None, focused_id="cn.tang.artifact.bull", packs=None):
        self.actions = []
        self.searches = []
        self.context_calls = 0
        self.mode = mode
        self.focused_id = focused_id
        self.packs = packs or {"cn.tang.core": "0.2.0"}

    async def state(self):
        return {
            "pack_versions": self.packs,
            "camera_pose": {"yaw": 0, "pitch": 0, "zoom": 1},
        }

    async def get(self, route, params=None):
        if route == "search":
            self.searches.append(params)
            return {"items": [{"id": "cn.tang.artifact.bull"}]}
        if route == "content":
            return {"artifact_id": "cn.tang.artifact.bull", "content_kind": "background",
                    "paragraphs": [{"content_id": "cn.tang.node.bull.01", "text": "准备的正文",
                                    "authorship": {"node_id": "cn.tang.node.bull.01", "story_id": "cn.tang.story.bull"}}]}
        self.context_calls += 1
        return {
            "revision": 3,
            "mode": self.mode,
            "focused_artifact": {
                "id": self.focused_id,
                "story_entry_ids": ["cn.tang.story.bull"],
                "presentation": {"background_node_id": "cn.tang.node.bull.01"},
            },
            "story_node": {"node_id": "cn.tang.node.bull.01"},
        }

    async def voice(self, operation, data=None, scope=None):
        self.actions.append((operation, data, scope))
        return {"status": "committed", "revision": 3}


def test_ambiguous_names_wait_for_choice_across_transport_reconnect_and_never_pick_bull():
    class MusicianClient(Client):
        async def get(self, route, params=None):
            if route == "search":
                self.searches.append(params)
                items = [
                    {"id": "cn.tang.artifact.flute-musician", "title": "吹笛乐俑"},
                    {"id": "cn.tang.artifact.lute-musician", "title": "弹拨乐俑"},
                ]
                return {"items": [item for item in items if params["q"] in item["title"]]}
            return await super().get(route, params)

    async def run():
        client, selection = MusicianClient(), SpokenSelection()
        first = InputOrchestrator(client, TrustedInput("bridge", "turn-1"), selection)
        result = await first.handle("看乐俑")
        assert result["kind"] == "clarification"
        assert len(selection.items) == 2
        assert client.actions == []
        second = InputOrchestrator(client, TrustedInput("bridge", "turn-2"), selection)
        assert second.owns_reply("我要看第二个")
        picked = await second.handle("我要看第二个")
        assert picked["receipt"]["status"] == "committed"
        assert client.actions[0][1]["target_id"] == "cn.tang.artifact.lute-musician"
        assert not selection.items

    asyncio.run(run())


def test_selection_accepts_chinese_ordinals_up_to_nineteen_without_substring_guessing():
    selection = SpokenSelection(items=[{"id": str(i), "title": f"测试展品{i}"} for i in range(1, 20)])
    assert selection.choose("第十九件") == "测试展品19"
    assert selection.choose("第十个") == "测试展品10"
    assert selection.choose("我要看第二个") == "测试展品2"
    assert selection.choose("一佛二菩萨造像碑") is None
    assert selection.choose("不要第二个") is None


def test_single_final_stt_executes_once_and_scope_cannot_relabel_late_input():
    async def run():
        client = Client()
        orchestration = InputOrchestrator(client, TrustedInput("bridge", "old-input"))
        assert (await orchestration.handle("看牛"))["receipt"]["status"] == "committed"
        assert await orchestration.handle("再往前走") is None
        assert client.actions[0][1]["action"] == "locate_artifact"
        assert client.actions[0][2].input_token == "old-input"
        await orchestration.close()
        assert await orchestration.handle("看铜钱") is None

    asyncio.run(run())


def test_background_reads_fixed_text_continue_does_not_advance_and_unknown_is_qa():
    async def run():
        client = Client()
        scope = TrustedInput("bridge", "input")
        orchestration = InputOrchestrator(client, scope)
        result = await orchestration.handle("介绍这个文物")
        assert orchestration.intent_kind == "background"
        assert result["narration"]["text"] == "准备的正文"
        assert result["narration"]["contentId"] == "cn.tang.node.bull.01"
        assert client.context_calls == 2
        assert (await InputOrchestrator(client, scope).handle("继续"))["kind"] == "resume"
        assert await InputOrchestrator(client, scope).handle("古人为什么喜欢它") is None
        assert client.actions == []

    asyncio.run(run())


def test_background_is_available_when_associated_story_is_not_openable():
    class DraftStoryClient(Client):
        async def get(self, route, params=None):
            result = await super().get(route, params)
            if route == "context":
                result["focused_artifact"]["story_entry_ids"] = []
            return result

    async def run():
        result = await InputOrchestrator(DraftStoryClient(), TrustedInput("bridge", "input")).handle("介绍这个文物")
        assert result["narration"]["text"] == "准备的正文"

    asyncio.run(run())


def test_background_rejects_an_open_story_belonging_to_another_artifact():
    class WrongStoryClient(Client):
        async def get(self, route, params=None):
            result = await super().get(route, params)
            if route == "content":
                result["paragraphs"][0]["authorship"]["story_id"] = "cn.tang.story.other"
            return result

    async def run():
        with pytest.raises(GatewayError, match="背景节点或故事归属不一致"):
            await InputOrchestrator(WrongStoryClient(), TrustedInput("bridge", "input")).handle("介绍这个文物")

    asyncio.run(run())


@pytest.mark.parametrize(
    ("utterance", "expected_query"),
    [("带我去看牛", "牛"), ("去看铜钱", "铜钱"), ("不要看铜钱了去看牛", "牛")],
)
def test_named_artifact_requests_use_authorized_search_then_commit(utterance, expected_query):
    async def run():
        client = Client()
        result = await InputOrchestrator(client, TrustedInput("bridge", "input")).handle(utterance)
        assert result["kind"] == "action"
        assert result["receipt"]["status"] == "committed"
        assert client.searches == [{"q": expected_query, "kind": "artifact", "limit": "50", "mode": "spoken"}]
        assert client.actions[0][1] == {
            "action": "locate_artifact", "target_id": "cn.tang.artifact.bull"
        }

    asyncio.run(run())


def test_multiple_spoken_candidates_return_ids_without_moving():
    class ManyClient(Client):
        async def get(self, route, params=None):
            if route == "search":
                self.searches.append(params)
                return {
                    "items": [
                        {"id": "cn.tang.artifact.lute-musician", "title": "弹拨乐俑"},
                        {"id": "cn.tang.artifact.flute-musician", "title": "吹笛乐俑"},
                    ]
                }
            return await super().get(route, params)

    async def run():
        client = ManyClient()
        result = await InputOrchestrator(client, TrustedInput("bridge", "input")).handle("看乐俑")
        assert result["kind"] == "clarification"
        assert result["diagnosis"]["candidate_ids"] == [
            "cn.tang.artifact.lute-musician",
            "cn.tang.artifact.flute-musician",
        ]
        assert "吹笛乐俑" in result["message"]
        assert client.actions == []

    asyncio.run(run())


def test_vague_artifact_request_returns_clarification_without_moving():
    async def run():
        client = Client()
        result = await InputOrchestrator(client, TrustedInput("bridge", "input")).handle("移动看一个东西")
        assert result["kind"] == "clarification"
        assert "展品名称" in result["message"]
        assert client.searches == []
        assert client.actions == []

    asyncio.run(run())


def test_browse_and_time_intents_dispatch_once_with_years():
    async def run():
        client = Client(mode="explore")
        next_group = await InputOrchestrator(client, TrustedInput("bridge", "input")).handle(
            "带我看看后面的文物"
        )
        assert next_group["kind"] == "action"
        assert client.actions[0][1] == {"action": "browse_gallery", "params": {"direction": "next"}}
        century = await InputOrchestrator(client, TrustedInput("bridge", "input-2")).handle(
            "看八世纪的文物"
        )
        assert century["kind"] == "action"
        assert client.actions[1][1] == {
            "action": "seek_time_range",
            "params": {"start_year": 701, "end_year": 800},
        }
        song = await InputOrchestrator(client, TrustedInput("bridge", "input-3")).handle("看宋朝的文物")
        assert song["kind"] == "clarification"
        assert "尚未开放" in song["message"]
        hall = await InputOrchestrator(client, TrustedInput("bridge", "input-4")).handle("进入宋代")
        assert hall is None


def test_song_session_does_not_call_song_unavailable_and_locates_from_published_pack():
    class SongClient(Client):
        def __init__(self):
            super().__init__(packs={"cn.song.core": "0.1.0"})

        async def get(self, route, params=None):
            if route == "search":
                self.searches.append(params)
                if params["q"] in {"青白瓷注子", "注子", "青白瓷壶"}:
                    return {"items": [{"id": "cn.song.artifact.qingbai-ewer", "title": "青白瓷注子"}]}
                if params["q"] == "茶盏":
                    return {"items": [
                        {"id": "cn.song.artifact.tea-bowl", "title": "兔毫茶盏"},
                        {"id": "cn.song.artifact.jian-bowl", "title": "建窑茶盏"},
                    ]}
                if params["q"] in {"牛", "鎏金牛"}:
                    return {"items": []}
                return {"items": []}
            return await super().get(route, params)

    async def run():
        client = SongClient()
        named = await InputOrchestrator(client, TrustedInput("bridge", "song")).handle("看宋朝的文物")
        assert named["kind"] == "clarification"
        assert "尚未开放" not in named["message"]
        located = await InputOrchestrator(client, TrustedInput("bridge", "ewer")).handle("看青白瓷注子")
        assert located["kind"] == "action"
        assert client.actions[-1][1]["target_id"] == "cn.song.artifact.qingbai-ewer"
        missing = await InputOrchestrator(client, TrustedInput("bridge", "bull")).handle("看鎏金牛")
        assert missing["kind"] == "clarification"
        assert "没有这件文物" in missing["message"]
        before = len(client.actions)
        bowls = await InputOrchestrator(client, TrustedInput("bridge", "tea")).handle("看茶盏")
        assert bowls["kind"] == "clarification"
        assert "茶盏" in bowls["message"]
        assert len(client.actions) == before

    asyncio.run(run())


def test_explore_return_to_overview_is_local_presentation_without_server_receipt():
    async def run():
        client = Client(mode="explore")
        result = await InputOrchestrator(
            client, TrustedInput("bridge", "input")
        ).handle("回到展厅")

        assert result["kind"] == "action"
        assert result["presentation_action"] == "return_to_overview"
        assert result["render_status"] == "pending"
        assert "receipt" not in result
        assert client.actions == []

    asyncio.run(run())


def test_return_to_hall_then_look_again_at_same_exhibit_is_local_focus():
    async def run():
        client = Client(mode="explore", focused_id="cn.tang.artifact.bull")
        returned = await InputOrchestrator(
            client, TrustedInput("bridge", "return")
        ).handle("回到展厅")
        assert returned["presentation_action"] == "return_to_overview"
        again = await InputOrchestrator(
            client, TrustedInput("bridge", "again")
        ).handle("再看牛")
        assert again["kind"] == "action"
        assert again["presentation_action"] == "focus_current"
        assert again["presentation_expected_focus_id"] == "cn.tang.artifact.bull"
        assert "receipt" not in again
        assert client.searches == [{"q": "牛", "kind": "artifact", "limit": "50", "mode": "spoken"}]
        assert client.actions == []

    asyncio.run(run())


def test_look_old_then_new_then_again_old_commits_locate_to_the_old_exhibit():
    class SwitchingClient(Client):
        def __init__(self):
            super().__init__(mode=None, focused_id="cn.tang.artifact.bull")
            self.ids = {
                "铜钱": "cn.tang.artifact.kaiyuan-coin",
                "镇墓兽": "cn.tang.artifact.tomb-guardian",
            }

        async def get(self, route, params=None):
            if route == "search":
                self.searches.append(params)
                return {"items": [{"id": self.ids[params["q"]]}]}
            return await super().get(route, params)

        async def voice(self, operation, data=None, scope=None):
            self.actions.append((operation, data, scope))
            if operation == "act" and data and data.get("action") == "locate_artifact":
                self.focused_id = data["target_id"]
            return {"status": "committed", "revision": 3}

    async def run():
        client = SwitchingClient()
        first = await InputOrchestrator(client, TrustedInput("bridge", "old")).handle("看铜钱")
        second = await InputOrchestrator(client, TrustedInput("bridge", "new")).handle("给我看看镇墓兽")
        again = await InputOrchestrator(client, TrustedInput("bridge", "old-again")).handle("再看铜钱")
        assert [item["kind"] for item in (first, second, again)] == ["action", "action", "action"]
        assert [item[1]["target_id"] for item in client.actions] == [
            "cn.tang.artifact.kaiyuan-coin",
            "cn.tang.artifact.tomb-guardian",
            "cn.tang.artifact.kaiyuan-coin",
        ]
        assert client.searches == [
            {"q": "铜钱", "kind": "artifact", "limit": "50", "mode": "spoken"},
            {"q": "镇墓兽", "kind": "artifact", "limit": "50", "mode": "spoken"},
            {"q": "铜钱", "kind": "artifact", "limit": "50", "mode": "spoken"},
        ]
        assert client.focused_id == "cn.tang.artifact.kaiyuan-coin"

    asyncio.run(run())


def test_explore_locate_current_artifact_is_local_presentation_without_receipt():
    async def run():
        client = Client(mode="explore")
        result = await InputOrchestrator(
            client, TrustedInput("bridge", "input")
        ).handle("带我去看牛")

        assert result["kind"] == "action"
        assert result["presentation_action"] == "focus_current"
        assert result["presentation_expected_focus_id"] == "cn.tang.artifact.bull"
        assert result["presentation_expected_revision"] == 3
        assert "receipt" not in result
        assert client.searches == [{"q": "牛", "kind": "artifact", "limit": "50", "mode": "spoken"}]
        assert client.actions == []

    asyncio.run(run())


def test_story_phrases_return_structured_requests_without_entering_story():
    async def run():
        client = Client(mode="explore")
        current = await InputOrchestrator(client, TrustedInput("bridge", "story")).handle(
            "请你给我讲讲这个故事"
        )
        named = await InputOrchestrator(client, TrustedInput("bridge", "named")).handle(
            "讲讲铜钱的故事"
        )
        assert current["kind"] == "story_request"
        assert current["story_request"]["kind"] == "explicit_current"
        assert named["kind"] == "story_request"
        assert named["story_request"]["kind"] == "explicit_named"
        assert named["story_request"]["query"] == "铜钱"
        assert named["story_request"]["artifact_id"] == "cn.tang.artifact.bull"
        assert client.actions == []
        assert client.searches == [{"q": "铜钱", "kind": "artifact", "limit": "50", "mode": "spoken"}]

    asyncio.run(run())


def test_content_from_previous_focus_is_rejected_when_focus_changes_during_read():
    class ChangingClient(Client):
        def __init__(self):
            super().__init__()
            self.changed = False

        async def get(self, route, params=None):
            if route == "content":
                self.changed = True
                return await super().get(route, params)
            value = await super().get(route, params)
            if self.changed:
                value["focused_artifact"] = {"id": "cn.tang.artifact.coin", "title": "铜钱"}
            return value

    async def run():
        client = ChangingClient()
        with pytest.raises(GatewayError, match="展台已变化"):
            await InputOrchestrator(client, TrustedInput("bridge", "input")).handle("介绍这个文物")

    asyncio.run(run())


def test_background_from_another_story_is_not_read_as_current_artifact():
    class WrongStoryClient(Client):
        async def get(self, route, params=None):
            value = await super().get(route, params)
            if route == "content":
                value["paragraphs"][0]["authorship"]["story_id"] = "cn.tang.story.other"
            return value

    async def run():
        with pytest.raises(GatewayError, match="背景节点或故事归属不一致"):
            await InputOrchestrator(WrongStoryClient(), TrustedInput("bridge", "input")).handle("介绍这个文物")

    asyncio.run(run())
