import asyncio

from museum_mcp.action_tools import TrustedInput
from museum_voice.control_orchestrator import InputOrchestrator


class Client:
    def __init__(self):
        self.actions = []

    async def state(self):
        return {
            "pack_versions": {"cn.tang.core": "0.2.0"},
            "camera_pose": {"yaw": 0, "pitch": 0, "zoom": 1},
        }

    async def get(self, route, params=None):
        if route == "search":
            return {"items": [{"id": "cn.tang.artifact.bull"}]}
        if route == "content":
            return {"paragraphs": [{"content_id": "cn.tang.node.bull.01", "text": "准备的正文"}]}
        return {
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
        assert (await InputOrchestrator(client, scope).handle("继续"))["kind"] == "resume"
        assert await InputOrchestrator(client, scope).handle("古人为什么喜欢它") is None
        assert client.actions == []

    asyncio.run(run())
