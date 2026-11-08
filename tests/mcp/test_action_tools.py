import asyncio

import pytest
from museum_mcp.action_tools import ActionTools, TrustedInput
from museum_mcp.application_client import GatewayError
from museum_mcp.intent_adapter import interpret


class Client:
    def __init__(self):
        self.submitted = []
        self.mode = "story"
        self.focused_id = "artifact-current"

    async def state(self):
        return {"camera_pose": {"yaw": 0, "pitch": 0, "zoom": 1}}

    async def get(self, route):
        return {
            "mode": self.mode,
            "focused_artifact": {
                "id": self.focused_id,
                "story_entry_ids": ["cn.tang.story.bull"],
            },
        }

    async def voice(self, operation, body=None, scope=None):
        if operation == "view":
            return {"status": "rendered", "camera": {"yaw": 0, "pitch": 0, "zoom": 1}}
        self.submitted.append(body)
        return {"status": "committed", "revision": 3}


def test_cloud_get_context_does_not_grant_action_permission():
    client = Client()
    with pytest.raises(GatewayError, match="可信输入"):
        asyncio.run(ActionTools(client).act("next"))
    assert client.submitted == []


def test_bounded_actions_use_existing_commands_and_keep_rendered_separate():
    client = Client()
    tools = ActionTools(client, TrustedInput("bridge-secret", "input-secret"))
    assert asyncio.run(tools.act("back"))["render_status"] == "pending"
    assert client.submitted[-1]["params"]["camera"]["yaw"] == -180
    asyncio.run(tools.act("enter_story"))
    assert client.submitted[-1]["target_id"] == "cn.tang.story.bull"
    asyncio.run(tools.act("next_segment"))
    assert client.submitted[-1]["action"] == "continue_story"


def test_exploration_return_and_repeat_focus_are_verified_presentation_actions_not_fake_receipts():
    client = Client()
    client.mode = "explore"
    tools = ActionTools(client, TrustedInput("bridge", "input"))
    focused = asyncio.run(tools.act("locate", "artifact-current"))
    returned = asyncio.run(tools.act("return"))
    assert focused["presentation_action"] == "focus_current"
    assert returned["presentation_action"] == "return_to_overview"
    assert "receipt" not in focused and "receipt" not in returned
    assert client.submitted == []


def test_continue_does_not_mean_next_segment_and_last_artifact_wins():
    assert interpret("继续").kind == "resume"
    assert interpret("下一段").kind == "next_segment"
    assert interpret("不要看铜钱了，去看牛").query == "牛"
    assert interpret("介绍一下这个文物").kind == "background"
    assert interpret("普通人也用它吗") is None
    assert interpret("不要看铜钱了，再往前走").kind == "next"
    assert interpret("它的背面为什么这么黑") is None


def test_museum_entry_consent_is_not_a_story_command():
    for phrase in ("可以", "带我进去", "进入博物馆", "带我进入博物馆", "开始参观", "我想去展厅"):
        assert interpret(phrase) is None
    assert interpret("看它的故事").kind == "story_current"
    assert interpret("背后的故事").kind == "story_current"
    assert interpret("看故事").kind == "story_current"
    assert interpret("带我看看背后的故事").kind == "story_current"


def test_browse_and_seek_map_to_single_version_guarded_commands():
    client = Client()
    client.mode = "explore"
    tools = ActionTools(client, TrustedInput("bridge", "input"))
    asyncio.run(tools.act("browse_next"))
    assert client.submitted[-1] == {"action": "browse_gallery", "params": {"direction": "next"}}
    asyncio.run(tools.act("browse_previous"))
    assert client.submitted[-1] == {"action": "browse_gallery", "params": {"direction": "previous"}}
    asyncio.run(tools.act("seek_time", start_year=701, end_year=800))
    assert client.submitted[-1] == {
        "action": "seek_time_range",
        "params": {"start_year": 701, "end_year": 800},
    }
    asyncio.run(tools.act("seek_clear"))
    assert client.submitted[-1] == {"action": "seek_time_range", "params": {"clear": True}}
