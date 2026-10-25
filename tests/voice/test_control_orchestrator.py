import asyncio

import pytest
from museum_mcp.action_tools import TrustedInput
from museum_mcp.application_client import GatewayError
from museum_voice.control_orchestrator import InputOrchestrator


class Client:
    def __init__(self):
        self.actions = []
        self.context_calls = 0

    async def state(self):
        return {
            "pack_versions": {"cn.tang.core": "0.2.0"},
            "camera_pose": {"yaw": 0, "pitch": 0, "zoom": 1},
        }

    async def get(self, route, params=None):
        if route == "search":
            return {"items": [{"id": "cn.tang.artifact.bull"}]}
        if route == "content":
            return {"artifact_id": "cn.tang.artifact.bull",
                    "paragraphs": [{"content_id": params["content_id"], "text": "准备的正文"}]}
        self.context_calls += 1
        return {
            "revision": 3,
            "focused_artifact": {
                "id": "cn.tang.artifact.bull",
                "story_entry_ids": ["cn.tang.story.bull"],
            },
            "story_node": {"node_id": "cn.tang.node.bull.01"},
        }

    async def voice(self, operation, data=None, scope=None):
        self.actions.append((operation, data, scope))
        return {"status": "committed", "revision": 3}


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
        result = await InputOrchestrator(client, scope).handle("介绍这个文物")
        assert result["narration"]["text"] == "准备的正文"
        assert result["narration"]["contentId"] == "cn.tang.artifact.bull"
        assert client.context_calls == 2
        assert (await InputOrchestrator(client, scope).handle("继续"))["kind"] == "resume"
        assert await InputOrchestrator(client, scope).handle("古人为什么喜欢它") is None
        assert client.actions == []

    asyncio.run(run())


@pytest.mark.parametrize(
    ("utterance", "expected_action"),
    [
        ("往博物馆后面走走", "move_next"),
        ("去里面", "move_next"),
        ("再往里", "move_next"),
        ("回入口", "move_previous"),
    ],
)
def test_spatial_directions_commit_one_station_and_wait_for_real_render(utterance, expected_action):
    async def run():
        client = Client()
        result = await InputOrchestrator(client, TrustedInput("bridge", "input")).handle(utterance)
        assert result["kind"] == "action"
        assert result["render_status"] == "pending"
        assert client.actions[0][1]["action"] == expected_action

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
